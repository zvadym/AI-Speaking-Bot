import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { Pool } from 'pg';
import type { BotAiClient, FollowUpHints, VocabularyItem } from '../client.js';
import type { PreparedUpdate } from '../../bot-runtime/contracts.js';
import { runBotUpdateEffect } from '../../bot-runtime/execution/effect-repository.js';
import { BotRuntimeHandlerError, type BotHandlerOutcome } from '../../bot-runtime/handler-registry.js';
import type { MessagePresentationService } from '../../bot-runtime/delivery/message-presentation.js';
import {
  editMessage, fetchAssistant, formatHints, formatVocabulary, localeRecord, localeText,
  markSupportUsed, messageId, mutateSupportPresentation, parseHints, supportMarkup,
  translatedMessage, type Locale, type SupportTelegramClient
} from '../../bot-runtime/support.js';
import { deliverTelegramText } from '../../bot-runtime/delivery/telegram-text-delivery.js';
import { vocabularyLanguage } from '../../vocabulary/types.js';
import { createVocabularySnapshot, loadVocabularySnapshot, bindVocabularySnapshot, type VocabularySnapshot } from '../../vocabulary/snapshots.js';

const SupportState = Annotation.Root({
  update: Annotation<PreparedUpdate>(),
  locale: Annotation<Locale>(),
  id: Annotation<number>(),
  translation: Annotation<string>(),
  hints: Annotation<FollowUpHints>(),
  items: Annotation<VocabularyItem[]>(),
  snapshot: Annotation<VocabularySnapshot|null>(),
  outcome: Annotation<BotHandlerOutcome>()
});

export function createSupportGraph({
  pool, getBotLocale, telegramClient, ai, presentation, vocabularyAddEnabled = () => true,
  effectRunner = runBotUpdateEffect, textDeliverer = deliverTelegramText
}: {
  pool: Pool;
  getBotLocale(botKey: string): unknown;
  telegramClient: SupportTelegramClient;
  ai: BotAiClient;
  presentation?: MessagePresentationService;
  vocabularyAddEnabled?(botKey:string):boolean;
  effectRunner?: typeof runBotUpdateEffect;
  textDeliverer?: typeof deliverTelegramText;
}) {
  return new StateGraph(SupportState)
    .addNode('validateAndAcknowledge', async ({ update }) => {
      const callback = update.input.callbackQuery;
      if (!callback || update.input.chatId === null) {
        throw new BotRuntimeHandlerError('invalid_support_callback', { retryable: false });
      }
      const locale = localeRecord(getBotLocale(update.botKey));
      try {
        await telegramClient.answerTelegramCallbackQuery(
          callback.id, localeText(locale, 'callback_translating', 'Preparing...'),
          { botKey: update.botKey }
        );
      } catch {
        // Ephemeral acknowledgement does not control durable processing.
      }
      // A transcript callback translates its own text; it has no assistant ID/ownership query.
      return update.route === 'callback.transcript_translate' ? { locale } : { locale, id: messageId(update) };
    })
    .addNode('translateTranscript', async ({ update, locale }) => {
      const raw = update.input.callbackQuery!.messageText;
      const prefix = localeText(locale, 'user_text_prefix_multiline', '');
      const transcript = (prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw).trim();
      if (!transcript) throw new BotRuntimeHandlerError('transcript_missing', { retryable: false });
      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'callback.transcript_translate:ai:v1',
        execute: async () => ({
          translation: await ai.translate(update.botKey, transcript, {
            decisionId: update.decisionId, chatId: update.input.chatId!,
            botKey: update.botKey, route: update.route
          })
        })
      });
      return { translation: String(effect.result.translation || '') };
    })
    .addNode('presentTranscript', async ({ update, translation, locale }) => {
      await editMessage(telegramClient, update,
        translatedMessage(update.input.callbackQuery!.messageText, translation, locale),
        { inline_keyboard: [[{
          text: localeText(locale, 'btn_translation', 'Translation'), callback_data: 'busy:1'
        }]] });
      return { outcome: { status: 'noop' } as BotHandlerOutcome };
    })
    .addNode('cacheOrTranslateAssistant', async ({ update, id }) => {
      // Ownership, cache read, inference and persistence stay inside the atomic effect.
      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'callback.translate:state:v1',
        execute: async (client) => {
          const row = await fetchAssistant(client, update, id);
          const cached = String(row.translation_base || '').trim();
          const translation = cached || await ai.translate(update.botKey, row.content, {
            decisionId: update.decisionId, chatId: update.input.chatId!,
            botKey: update.botKey, route: update.route
          });
          if (!cached) {
            await client.query(
              `UPDATE messages SET translation_base = $1
                WHERE id = $2 AND chat_id = $3 AND bot_key = $4 AND role = 'assistant'`,
              [translation, id, update.input.chatId, update.botKey]
            );
          }
          return { translation };
        }
      });
      return { translation: String(effect.result.translation || '') };
    })
    .addNode('presentAssistantTranslation', async ({ update, id, translation, locale }) => {
      if (!await mutateSupportPresentation(presentation, update, id, locale, 'tr', translation)) {
        await editMessage(telegramClient, update,
          translatedMessage(update.input.callbackQuery!.messageText, translation, locale),
          supportMarkup(id, update.routingFacts.callback?.tier, 0, locale));
      }
      return { outcome: { status: 'noop' } as BotHandlerOutcome };
    })
    .addNode('cacheOrGenerateHints', async ({ update, id }) => {
      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'callback.hints:state:v1',
        execute: async (client) => {
          const row = await fetchAssistant(client, update, id);
          const cached = parseHints(row.follow_up_hints);
          const hints = cached || await ai.hints({
            botKey: update.botKey, level: String(row.level || 'a1'),
            userMessage: String(row.user_content || ''), assistantReply: String(row.content || ''),
            trace: { decisionId: update.decisionId, chatId: update.input.chatId!,
              botKey: update.botKey, route: update.route }
          });
          if (!cached) {
            await client.query(
              `UPDATE messages SET follow_up_hints = $1
                WHERE id = $2 AND chat_id = $3 AND bot_key = $4 AND role = 'assistant'`,
              [JSON.stringify(hints), id, update.input.chatId, update.botKey]
            );
          }
          return { hints };
        }
      });
      return { hints: effect.result.hints as FollowUpHints };
    })
    .addNode('deliverHints', async ({ update, hints, locale }) => ({
      outcome: await textDeliverer({ pool, update, telegramClient,
        stepKey: 'callback.hints:message:v1', text: formatHints(hints, locale), parseMode: 'HTML' })
    }))
    .addNode('generateVocabulary', async ({ update, id }) => {
      const effect = await effectRunner(pool, {
        decisionId: update.decisionId,
        stepKey: 'callback.vocab:ai:v1',
        execute: async (client) => {
          const row = await fetchAssistant(client, update, id);
          return { items: await ai.vocabulary(update.botKey, String(row.content || ''), {
            decisionId: update.decisionId, chatId: update.input.chatId!,
            botKey: update.botKey, route: update.route
          }) };
        }
      });
      return { items: effect.result.items as VocabularyItem[] };
    })
    .addNode('prepareVocabularySnapshot', async ({update,items,id}) => {
      const language=vocabularyLanguage(update.botKey.split('-')[1]);
      if(!language||!items.length||!vocabularyAddEnabled(update.botKey))return {snapshot:null};
      const effect=await effectRunner(pool,{decisionId:update.decisionId,stepKey:'callback.vocab:snapshot:v1',execute:async client=>{
        const source=await fetchAssistant(client,update,id);
        return {snapshotId:await createVocabularySnapshot(client,update,language,id,source.content,items,ai)};
      }});
      if(!effect.result.snapshotId)throw new Error('vocabulary_snapshot_missing');
      return {snapshot:await loadVocabularySnapshot(pool,String(effect.result.snapshotId),update.input.chatId!,update.botKey)};
    })
    .addNode('deliverVocabulary', async ({ update, items, locale, snapshot }) => {
      const outcome=await textDeliverer({ pool, update,
        telegramClient: { sendTelegramTextMessage: async (chatId) => telegramClient.callTelegramApi(
          update.botKey, 'sendRichMessage', { chat_id: chatId, rich_message: snapshot
            ? formatVocabulary(snapshot.rows.map(r=>r.item),locale,snapshot.rows) : formatVocabulary(items, locale) }
        ) as Promise<{ message_id?: unknown }> },
        stepKey: 'callback.vocab:message:v1', telegramMethod: 'sendRichMessage', text: '' });
      if(snapshot&&outcome.telegramMessageId)await bindVocabularySnapshot(pool,snapshot.id,update.input.chatId!,update.botKey,outcome.telegramMessageId);
      return {outcome};
    })
    .addNode('markUsed', async ({ update, id, locale }) => {
      await markSupportUsed(presentation, telegramClient, update, id, locale,
        update.route === 'callback.hints' ? 'hint' : 'voc', update.route === 'callback.hints' ? 1 : 2);
      return {};
    })
    .addEdge(START, 'validateAndAcknowledge')
    .addConditionalEdges('validateAndAcknowledge', ({ update }) => {
      switch (update.route) {
        case 'callback.transcript_translate': return 'translateTranscript';
        case 'callback.translate': return 'cacheOrTranslateAssistant';
        case 'callback.hints': return 'cacheOrGenerateHints';
        case 'callback.vocab': return 'generateVocabulary';
        default: throw new BotRuntimeHandlerError('invalid_support_callback', { retryable: false });
      }
    }, ['translateTranscript', 'cacheOrTranslateAssistant', 'cacheOrGenerateHints', 'generateVocabulary'])
    .addEdge('translateTranscript', 'presentTranscript')
    .addEdge('presentTranscript', END)
    .addEdge('cacheOrTranslateAssistant', 'presentAssistantTranslation')
    .addEdge('presentAssistantTranslation', END)
    .addEdge('cacheOrGenerateHints', 'deliverHints')
    .addEdge('deliverHints', 'markUsed')
    .addEdge('generateVocabulary', 'prepareVocabularySnapshot')
    .addEdge('prepareVocabularySnapshot', 'deliverVocabulary')
    .addEdge('deliverVocabulary', 'markUsed')
    .addEdge('markUsed', END)
    .compile();
}
