import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  createProgressService,
  normalizeProgressMessages,
  normalizeProgressText
} from '../src/bot-runtime/progress-service.js';

interface MemoryState {
  chat_id: number;
  bot_key: string;
  stop_flag: boolean;
  session_id: string;
  message_id: number | null;
  started_at: Date;
  updated_at: Date;
}

class MemoryLoaderDb {
  state: MemoryState | null = null;
  queries: string[] = [];

  async query(text: string, params: unknown[] = []) {
    this.queries.push(text.replace(/\s+/gu, ' ').trim());
    if (text.includes('FROM loader_flags')) {
      const chatId = Number(params[0]);
      const botKey = String(params[1]);
      return {
        rows: this.state && this.state.chat_id === chatId && this.state.bot_key === botKey
          ? [{ ...this.state }]
          : [],
        rowCount: this.state ? 1 : 0
      };
    }
    if (text.includes('INSERT INTO loader_flags')) {
      this.state = {
        chat_id: Number(params[0]),
        bot_key: String(params[1]),
        session_id: String(params[2]),
        message_id: Number(params[3]),
        stop_flag: false,
        started_at: new Date(),
        updated_at: new Date()
      };
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE loader_flags') && this.state) {
      const requestedSession = params[2] === null || params[2] === undefined
        ? null
        : String(params[2]);
      if (!requestedSession || this.state.session_id === requestedSession) {
        this.state.stop_flag = true;
        this.state.message_id = null;
        this.state.updated_at = new Date();
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release() {}
    };
  }

  pool(): Pool {
    return this as unknown as Pool;
  }
}

function harness(options: { failJobAt?: number } = {}) {
  const db = new MemoryLoaderDb();
  const jobs: Array<{
    name: string;
    data: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const sent: Array<{ chatId: number; text: string; botKey: string }> = [];
  const edited: Array<{ chatId: number; messageId: number; text: string; botKey: string }> = [];
  const deleted: Array<{ chatId: number; messageId: number; botKey: string }> = [];
  let nextMessageId = 50;
  const boss = {
    async send(name: string, data: object, sendOptions: Record<string, unknown>) {
      jobs.push({ name, data: data as Record<string, unknown>, options: sendOptions });
      if (options.failJobAt === jobs.length) return null;
      return `00000000-0000-4000-8000-${String(jobs.length).padStart(12, '0')}`;
    }
  };
  const telegramClient = {
    async sendTelegramTextMessage(chatId: number, text: string, input: { botKey: string }) {
      sent.push({ chatId, text, botKey: input.botKey });
      nextMessageId += 1;
      return { message_id: nextMessageId };
    },
    async editTelegramMessageText(
      chatId: number,
      messageId: number,
      text: string,
      input: { botKey: string }
    ) {
      edited.push({ chatId, messageId, text, botKey: input.botKey });
      return { ok: true };
    },
    async deleteTelegramMessage(chatId: number, messageId: number, input: { botKey: string }) {
      deleted.push({ chatId, messageId, botKey: input.botKey });
      return { ok: true };
    }
  };
  const service = createProgressService({
    pool: db.pool(),
    boss,
    telegramClient,
    randomUUID: () => '00000000-0000-4000-8000-000000000777',
    random: () => 0.99
  });
  return { db, jobs, sent, edited, deleted, service, telegramClient };
}

test('progress text normalization is bounded and removes empty variants', () => {
  assert.equal(normalizeProgressText('  waiting  '), 'waiting');
  assert.deepEqual(normalizeProgressMessages([' first ', '', null, 'second']), [
    'first',
    'second'
  ]);
  assert.equal(normalizeProgressMessages(Array.from({ length: 40 }, (_, index) => `${index}`)).length, 32);
});

test('progress start serializes state and schedules one-shot rotation plus timeout', async () => {
  const { db, jobs, sent, service } = harness();
  const session = await service.start({
    chatId: 7001,
    botKey: 'uk-de',
    waitingText: 'Waiting',
    messages: ['One', 'Two']
  });

  assert.deepEqual(session, {
    sessionId: '00000000-0000-4000-8000-000000000777',
    messageId: 51
  });
  assert.deepEqual(sent, [{ chatId: 7001, text: 'Waiting', botKey: 'uk-de' }]);
  assert.equal(db.state?.stop_flag, false);
  assert.equal(db.state?.message_id, 51);
  assert.ok(db.queries.some((query) => query.includes('pg_advisory_xact_lock')));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].name, 'loader-rotate');
  assert.equal(jobs[0].options.startAfter, 5);
  assert.equal(jobs[0].data.step, 0);
  assert.equal(jobs[1].name, 'loader-timeout-cleanup');
  assert.equal(jobs[1].options.startAfter, 60);
});

test('progress rotation edits once and schedules only the next step', async () => {
  const { jobs, edited, service } = harness();
  const session = await service.start({
    chatId: 7002,
    botKey: 'uk-de',
    waitingText: 'Waiting',
    messages: ['One', 'Two']
  });
  const firstRotation = jobs[0].data;
  jobs.length = 0;

  assert.equal(await service.rotate(firstRotation), true);
  assert.deepEqual(edited, [{
    chatId: 7002,
    messageId: session.messageId,
    text: 'One',
    botKey: 'uk-de'
  }]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].name, 'loader-rotate');
  assert.equal(jobs[0].data.step, 1);
  assert.match(String(jobs[0].options.singletonKey), /:1$/u);
});

test('progress stop is session-scoped and deletes only the matching message', async () => {
  const { db, deleted, service } = harness();
  const session = await service.start({
    chatId: 7003,
    botKey: 'uk-de',
    waitingText: 'Waiting',
    messages: []
  });

  assert.equal(await service.stop({
    chatId: 7003,
    botKey: 'uk-de',
    sessionId: 'different-session'
  }), false);
  assert.equal(deleted.length, 0);
  assert.equal(db.state?.stop_flag, false);

  assert.equal(await service.stop({
    chatId: 7003,
    botKey: 'uk-de',
    sessionId: session.sessionId
  }), true);
  assert.deepEqual(deleted, [{ chatId: 7003, messageId: 51, botKey: 'uk-de' }]);
  assert.equal(db.state?.stop_flag, true);
  assert.equal(db.state?.message_id, null);
});

test('progress replacement commits the new session before deleting the previous message', async () => {
  const { db, deleted, service } = harness();
  await service.start({
    chatId: 7010,
    botKey: 'uk-de',
    waitingText: 'First waiting',
    messages: ['One']
  });
  const replacement = await service.start({
    chatId: 7010,
    botKey: 'uk-de',
    waitingText: 'Second waiting',
    messages: ['Two']
  });

  assert.equal(replacement.messageId, 52);
  assert.equal(db.state?.message_id, 52);
  assert.equal(db.state?.stop_flag, false);
  assert.deepEqual(deleted, [{ chatId: 7010, messageId: 51, botKey: 'uk-de' }]);
});

test('failed replacement leaves the previous active loader state intact', async () => {
  const base = harness();
  await base.service.start({
    chatId: 7011,
    botKey: 'uk-de',
    waitingText: 'First waiting',
    messages: ['One']
  });
  const previousState = { ...base.db.state } as MemoryState;
  const failingService = createProgressService({
    pool: base.db.pool(),
    boss: {
      async send() { return '00000000-0000-4000-8000-000000000999'; }
    },
    telegramClient: {
      ...base.telegramClient,
      async sendTelegramTextMessage() {
        throw new Error('telegram unavailable');
      }
    }
  });

  await assert.rejects(
    () => failingService.start({
      chatId: 7011,
      botKey: 'uk-de',
      waitingText: 'Second waiting',
      messages: ['Two']
    }),
    /telegram unavailable/
  );
  assert.deepEqual(base.db.state, previousState);
  assert.equal(base.deleted.length, 0);
});

test('progress start rolls back Telegram state when queue scheduling fails', async () => {
  const { db, deleted, service } = harness({ failJobAt: 2 });
  await assert.rejects(
    () => service.start({
      chatId: 7004,
      botKey: 'uk-de',
      waitingText: 'Waiting',
      messages: ['One']
    }),
    /progress_timeout_enqueue_failed/
  );
  assert.deepEqual(deleted, [{ chatId: 7004, messageId: 51, botKey: 'uk-de' }]);
  assert.equal(db.state?.stop_flag, true);
  assert.equal(db.state?.message_id, null);
});

test('progress timeout cleans only its own active session', async () => {
  const { db, deleted, service } = harness();
  const session = await service.start({
    chatId: 7005,
    botKey: 'uk-de',
    waitingText: 'Waiting',
    messages: ['One']
  });
  assert.equal(await service.timeout({
    chatId: 7005,
    botKey: 'uk-de',
    sessionId: 'old-session'
  }), false);
  assert.equal(await service.timeout({
    chatId: 7005,
    botKey: 'uk-de',
    sessionId: session.sessionId
  }), true);
  assert.equal(deleted.length, 1);
  assert.equal(db.state?.stop_flag, true);
});

test('progress rotation stops cleanly when Telegram message is gone', async () => {
  const base = harness();
  const service = createProgressService({
    pool: base.db.pool(),
    boss: {
      async send(name: string, data: object, options: Record<string, unknown>) {
        base.jobs.push({ name, data: data as Record<string, unknown>, options });
        return `00000000-0000-4000-8000-${String(base.jobs.length).padStart(12, '0')}`;
      }
    },
    telegramClient: {
      ...base.telegramClient,
      async editTelegramMessageText() {
        throw Object.assign(new Error('Bad Request'), {
          telegramDescription: 'Bad Request: message to edit not found'
        });
      }
    },
    randomUUID: () => '00000000-0000-4000-8000-000000000778'
  });
  await service.start({
    chatId: 7006,
    botKey: 'uk-de',
    waitingText: 'Waiting',
    messages: ['One']
  });
  const rotation = base.jobs[0].data;
  base.jobs.length = 0;

  assert.equal(await service.rotate(rotation), false);
  assert.equal(base.jobs.length, 0);
  assert.equal(base.db.state?.stop_flag, true);
});
