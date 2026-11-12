import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { BotAiClient } from './bot-runtime/bot-ai.js';
import { DiscordFeedbackDeliveryError, sendDiscordFeedbackNotification } from './discord-events.js';

export const FEEDBACK_NOTIFICATION_QUEUE = 'feedback-notification-scan';
// Telegram cloud getFile supports at most 20 MB; Discord's default attachment
// allowance is 20 MiB. Keep the lower bound, below its 25 MiB request limit.
export const MAX_FEEDBACK_AUDIO_BYTES = 20_000_000;
const MAX_PREPARATION_ATTEMPTS = 5;

interface FeedbackRecord extends Record<string, unknown> {
  id: string; chat_id: string; bot_key: string; kind: 'text' | 'voice';
  feedback_text: string | null; transcript: string | null; telegram_file_id: string | null;
  username: string | null; first_name: string | null; category: string | null; source: string;
  created_at: Date; attempts: number; transcript_status: string; attachment_error_code: string | null;
}
interface FeedbackTelegramClient {
  callTelegramApi(botKey: string, method: string, body: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<unknown>;
  downloadTelegramFile(fileId: string, options: {botKey: string}): Promise<Buffer>;
}
export interface FeedbackNotificationDependencies {
  pool: Pool;
  webhookUrl: string;
  telegramClient: FeedbackTelegramClient;
  ai: Pick<BotAiClient, 'transcribe'>;
  botMetaForKey?: (key: string) => unknown;
  sender?: typeof sendDiscordFeedbackNotification;
}
interface FeedbackBoss {
  createQueue(name: string, options?: object): Promise<unknown>;
  schedule(name: string, cron: string, data: object, options: object): Promise<unknown>;
  send(name: string, data: object, options?: object): Promise<unknown>;
  work(name: string, options: object, handler: (jobs: unknown[]) => Promise<void>): Promise<unknown>;
}

export async function wakeFeedbackNotifications(boss: Pick<FeedbackBoss, 'send'> | null | undefined): Promise<void> {
  if (!boss) return;
  try { await boss.send(FEEDBACK_NOTIFICATION_QUEUE, {}, {singletonKey: 'feedback-scan', singletonSeconds: 1}); }
  catch { /* The durable outbox remains discoverable by the scheduled scan. */ }
}

async function claimFeedback(pool: Pool, token: string): Promise<FeedbackRecord | null> {
  const result = await pool.query<FeedbackRecord>(`WITH picked AS (
    SELECT feedback_id FROM feedback_notifications
    WHERE status='pending' AND next_attempt_at<=NOW()
    ORDER BY next_attempt_at,feedback_id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE feedback_notifications n SET status='preparing',attempts=attempts+1,
      lease_token=$1::uuid,lease_expires_at=NOW()+INTERVAL '5 minutes',updated_at=NOW()
    FROM picked p WHERE n.feedback_id=p.feedback_id
    RETURNING n.feedback_id,n.attempts,n.transcript_status,n.attachment_error_code
  ) SELECT f.*,f.id::text, f.chat_id::text,c.attempts,c.transcript_status,c.attachment_error_code
    FROM claimed c JOIN feedback f ON f.id=c.feedback_id`, [token]);
  return result.rows[0] || null;
}

async function preparationTimeout<T>(work: Promise<T>,timeoutMs=45_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work,new Promise<never>((_,reject) => {
      timer=setTimeout(() => reject(new Error('feedback_preparation_timeout')),timeoutMs);
      timer.unref();
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** All external work happens after autocommitted claims, never in a DB transaction. */
export async function processFeedbackNotifications(
  deps: FeedbackNotificationDependencies,
  {limit=5}: {limit?: number} = {}
): Promise<{sent:number;unknown:number;retried:number;failed:number}> {
  const result={sent:0,unknown:0,retried:0,failed:0};
  if (!deps.webhookUrl.trim()) return result;
  const {pool}=deps;
  // A crash before sending is safe to retry. A crash after reserving a send is
  // ambiguous: leave it for inspection rather than duplicating a webhook post.
  await pool.query(`UPDATE feedback_notifications SET
    status=CASE WHEN status='sending' THEN 'unknown' ELSE 'pending' END,
    last_error_code=CASE WHEN status='sending' THEN 'discord_send_lease_expired' ELSE 'feedback_preparation_lease_expired' END,
    lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
    WHERE status IN ('preparing','sending') AND lease_expires_at<NOW()`);
  for(let index=0;index<Math.max(0,Math.min(50,limit));index++) {
    const token=randomUUID();
    const feedback=await claimFeedback(pool,token);
    if(!feedback) break;
    let audio: Buffer | null=null;
    let transcript=feedback.transcript || '';
    let attachmentError=feedback.attachment_error_code;
    if(feedback.kind==='voice' && !attachmentError) {
      try {
        const meta=await deps.telegramClient.callTelegramApi(feedback.bot_key,'getFile',
          {file_id:feedback.telegram_file_id},{signal:AbortSignal.timeout(15000)}) as {file_size?:number};
        if(Number(meta?.file_size)>MAX_FEEDBACK_AUDIO_BYTES) attachmentError='feedback_audio_too_large';
        else {
          audio=await preparationTimeout(deps.telegramClient.downloadTelegramFile(feedback.telegram_file_id!,{botKey:feedback.bot_key}));
          if(audio.length>MAX_FEEDBACK_AUDIO_BYTES) {audio=null;attachmentError='feedback_audio_too_large';}
        }
      } catch(error) {
        const status=Number((error as {telegramStatus?:number}).telegramStatus);
        if(status===400||status===403||status===404||feedback.attempts>=MAX_PREPARATION_ATTEMPTS) {
          attachmentError='feedback_audio_unavailable';
        } else {
          await pool.query(`UPDATE feedback_notifications SET status='pending',next_attempt_at=NOW()+INTERVAL '30 seconds',
            lease_token=NULL,lease_expires_at=NULL,last_error_code='feedback_audio_download_failed',updated_at=NOW()
            WHERE feedback_id=$1 AND lease_token=$2::uuid AND status='preparing'`,[feedback.id,token]);
          result.retried++; continue;
        }
      }
    }
    let transcriptStatus=feedback.kind==='text'?'none':transcript?'complete':feedback.transcript_status;
    if(feedback.kind==='voice' && !transcript && transcriptStatus==='pending') {
      if(audio) {
        try {
          transcript=(await preparationTimeout(deps.ai.transcribe(feedback.bot_key,audio,{baseLanguage:true,
            trace:{chatId:Number(feedback.chat_id),botKey:feedback.bot_key,route:'feedback.notification'}}),135_000)).trim();
        } catch { /* The original recording is useful even when ASR is unavailable. */ }
      }
      transcriptStatus=transcript?'complete':'unavailable';
    }
    // Cache the transcript with the lease fence. A Discord retry can download
    // the original again but never repeats successful transcription.
    const cached=await pool.query(`WITH owned AS (
      UPDATE feedback_notifications SET transcript_status=$3,attachment_error_code=$4,updated_at=NOW()
      WHERE feedback_id=$1 AND lease_token=$2::uuid AND status='preparing' RETURNING feedback_id
    ) UPDATE feedback f SET transcript=$5 FROM owned o
      WHERE f.id=o.feedback_id RETURNING f.id`,[feedback.id,token,transcriptStatus,attachmentError,transcript||null]);
    if(!cached.rowCount) continue;
    const notes=[];
    if(feedback.kind==='voice'&&!transcript) notes.push('Transcript unavailable; the original recording reference is preserved in the feedback record.');
    if(attachmentError==='feedback_audio_too_large') notes.push('Original audio exceeds the supported 20 MB download/attachment size; Telegram file reference is preserved.');
    else if(attachmentError) notes.push('Original audio could not be attached; Telegram file reference is preserved.');
    const text=[feedback.kind==='voice'?transcript:feedback.feedback_text,...notes].filter(Boolean).join('\n\n');
    const reserved=await pool.query(`UPDATE feedback_notifications SET status='sending',
      lease_expires_at=NOW()+INTERVAL '1 minute',last_error_code=NULL,updated_at=NOW()
      WHERE feedback_id=$1 AND lease_token=$2::uuid AND status='preparing' RETURNING feedback_id`,[feedback.id,token]);
    if(!reserved.rowCount) continue;
    try {
      const delivered=await (deps.sender||sendDiscordFeedbackNotification)({webhookUrl:deps.webhookUrl,
        event:{...feedback,type:'user_feedback',feedback_id:feedback.id,feedback_text:text},botMetaForKey:deps.botMetaForKey,
        attachments:audio?[{name:'feedback.ogg',data:audio,contentType:'audio/ogg'}]:[]});
      const marked=await pool.query(`UPDATE feedback_notifications SET status='sent',discord_message_id=$3,
        delivered_at=NOW(),updated_at=NOW(),lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL
        WHERE feedback_id=$1 AND lease_token=$2::uuid AND status='sending'`,[feedback.id,token,delivered.messageId]);
      if(marked.rowCount)result.sent++;else result.unknown++;
    } catch(error) {
      const failure=error instanceof DiscordFeedbackDeliveryError?error:null;
      // DB errors after an acknowledged send are also ambiguous. The saved send
      // reservation is retained as unknown (or expires into unknown).
      const kind=failure?.kind||'unknown';
      const attachmentRejected=failure?.code==='discord_feedback_http_413' && Boolean(audio);
      const status=attachmentRejected||kind==='retryable'?'pending':kind==='permanent'?'failed':'unknown';
      const delay=Math.max(1000,Number(failure?.retryAfterMs)||30000);
      await pool.query(`UPDATE feedback_notifications SET status=$3,next_attempt_at=NOW()+($4::int*INTERVAL '1 millisecond'),
        last_error_code=$5,attachment_error_code=CASE WHEN $6 THEN 'discord_attachment_rejected' ELSE attachment_error_code END,
        lease_token=NULL,lease_expires_at=NULL,updated_at=NOW()
        WHERE feedback_id=$1 AND lease_token=$2::uuid AND status='sending'`,
      [feedback.id,token,status,delay,failure?.code||'discord_feedback_send_ambiguous',attachmentRejected]);
      if(status==='pending')result.retried++;else if(status==='unknown')result.unknown++;else result.failed++;
    }
  }
  return result;
}

export async function registerFeedbackNotifications(boss: FeedbackBoss, deps: FeedbackNotificationDependencies): Promise<void> {
  await boss.createQueue(FEEDBACK_NOTIFICATION_QUEUE,{retryLimit:0,expireInSeconds:1200});
  await boss.work(FEEDBACK_NOTIFICATION_QUEUE,{batchSize:1,pollingIntervalSeconds:1},async()=>{
    const result=await processFeedbackNotifications(deps);
    if(Object.values(result).some(Boolean))console.info('feedback-notifications:processed',result);
  });
  await boss.schedule(FEEDBACK_NOTIFICATION_QUEUE,'* * * * *',{}, {key:'default'});
  await wakeFeedbackNotifications(boss);
}
