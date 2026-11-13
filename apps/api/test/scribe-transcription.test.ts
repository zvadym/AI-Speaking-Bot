import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { transcribeWithScribe } from '../src/infrastructure/speech/scribe-transcription.js';
import { createBotAiClient } from '../src/bot-runtime/bot-ai.js';
import type { LlmCallEvent } from '../src/bot-runtime/llm-telemetry.js';

test('runtime requires the Scribe key only when Scribe is selected', () => {
  for (const [model, key, expectedStatus] of [
    ['', '', 1], ['scribe_v2', ' ', 1], ['scribe_v2', 'test-key', 0], ['whisper-1', '', 0]
  ] as const) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "import { env } from './src/env.js'; console.log(env.botTranscriptionModel)"
    ], { encoding: 'utf8', env: { ...process.env, BOT_TRANSCRIPTION_MODEL: model, ELEVENLABS_API_KEY: key } });
    assert.equal(result.status, expectedStatus, result.stderr);
    if (expectedStatus) assert.match(result.stderr, /Missing required env var: ELEVENLABS_API_KEY/);
    else assert.equal(result.stdout.trim().split('\n').at(-1), model);
  }
});

test('default STT preserves disfluencies and events for target and feedback languages', async () => {
  const events: LlmCallEvent[] = [];
  const languages: unknown[] = [];
  const original = Buffer.from('original-ogg-bytes');
  const text = 'Um, I, I goed (laughing) mm to shop.';
  const client = createBotAiClient({
    apiKey: '', // STT must not require or instantiate OpenAI.
    elevenlabsApiKey: 'test-key',
    model: 'test-model',
    getBotConfig: () => ({ base_language: 'uk', learning_language: 'en' }),
    createClient: () => { throw new Error('unexpected_openai_call'); },
    recordLlmCall: async (event) => { events.push(event); },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.elevenlabs.io/v1/speech-to-text');
      assert.equal(options?.method, 'POST');
      assert.equal(new Headers(options?.headers).get('xi-api-key'), 'test-key');
      assert.ok(options?.signal instanceof AbortSignal);
      const form = options?.body as FormData;
      assert.equal(form.get('model_id'), 'scribe_v2');
      assert.equal(form.get('no_verbatim'), 'false');
      assert.equal(form.get('tag_audio_events'), 'true');
      assert.equal(form.get('diarize'), 'false');
      assert.equal(form.get('timestamps_granularity'), 'word');
      for (const key of ['transcript_edit', 'keyterms', 'prompt', 'source_url', 'webhook']) {
        assert.equal(form.has(key), false);
      }
      languages.push(form.get('language_code'));
      const file = form.get('file') as File;
      assert.equal(file.name, 'voice.ogg');
      assert.equal(file.type, 'audio/ogg');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), original);
      return Response.json({ text, edited_transcript: 'I went to the shop.' });
    }
  });
  assert.equal(await client.transcribe('uk-en', original), text);
  assert.equal(await client.transcribe('uk-en', original, { baseLanguage: true }), text);
  assert.deepEqual(languages, ['en', 'uk']);
  assert.deepEqual(events.map(({ model, operation, success }) => ({ model, operation, success })), [
    { model: 'scribe_v2', operation: 'conversation.transcribe', success: true },
    { model: 'scribe_v2', operation: 'feedback.transcribe', success: true }
  ]);
});

for (const status of [401, 429, 500]) {
  test(`Scribe HTTP ${status} is recorded without leaking response or falling back`, async () => {
    const events: LlmCallEvent[] = [];
    let calls = 0;
    const client = createBotAiClient({
      apiKey: '', elevenlabsApiKey: 'test-key', model: 'test-model',
      getBotConfig: () => ({ learning_language: 'en' }),
      recordLlmCall: async (event) => { events.push(event); },
      createClient: () => { throw new Error('unexpected_openai_call'); },
      fetchImpl: async () => {
        calls++;
        return new Response('private-provider-response', { status });
      }
    });
    await assert.rejects(client.transcribe('uk-en', Buffer.from('voice')), {
      message: `elevenlabs_stt_http_${status}`, code: `elevenlabs_stt_http_${status}`
    });
    assert.equal(calls, 1);
    assert.equal(events[0].success, false);
    assert.equal(events[0].errorCode, `elevenlabs_stt_http_${status}`);
  });
}

test('Scribe rejects missing credentials before sending audio', async () => {
  await assert.rejects(transcribeWithScribe({
    apiKey: ' ', audio: Buffer.from('voice'), language: 'en',
    fetchImpl: async () => { throw new Error('unexpected_fetch'); }
  }), /missing_elevenlabs_api_key/);
});

test('Scribe rejects malformed responses but accepts an empty transcript', async () => {
  for (const body of ['not-json-private-response', '{}', '{"text":42}', 'null']) {
    await assert.rejects(transcribeWithScribe({
      apiKey: 'test-key', audio: Buffer.from('voice'), language: 'en',
      fetchImpl: async () => new Response(body)
    }), { message: 'elevenlabs_stt_invalid_response' });
  }
  assert.deepEqual(await transcribeWithScribe({
    apiKey: 'test-key', audio: Buffer.from('voice'), language: 'en',
    fetchImpl: async () => Response.json({ text: '' })
  }), { text: '' });
});

test('Scribe request timeout aborts the request', async () => {
  // Keep the event loop alive while AbortSignal.timeout uses an unref-ed timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(transcribeWithScribe({
      apiKey: 'test-key', audio: Buffer.from('voice'), language: 'en', timeoutMs: 10,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        const signal = options!.signal!;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    }), { name: 'TimeoutError' });
  } finally {
    clearInterval(keepAlive);
  }
});
