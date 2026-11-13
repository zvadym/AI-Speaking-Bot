import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStructuredResponse, type StructuredResponseInput } from '../src/ai/models/structured-response.js';

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false
};
const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 20 },
  output_tokens: 15,
  output_tokens_details: { reasoning_tokens: 5 },
  total_tokens: 115
};
const outputText = '{"answer":"Hello"}';

function response(text = outputText, overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-5-mini-2025-08-07',
    error: null,
    incomplete_details: null,
    output: [{
      id: 'msg_fixture',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }]
    }],
    usage,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function sseResponse(events: Record<string, unknown>[]) {
  const text = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
  // Exercise the SDK's HTTP/SSE parser across arbitrary transport boundaries.
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 17) controller.enqueue(bytes.slice(offset, offset + 17));
      controller.close();
    }
  }), { headers: { 'content-type': 'text/event-stream' } });
}

function fixture(replies: (() => Response)[]) {
  const requests: Array<{ url: URL; body: Record<string, unknown> }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: new URL(String(url)), body: JSON.parse(String(init?.body)) });
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    return reply();
  };
  return { requests, fetchImpl };
}

function input(fetchImpl: typeof fetch, extra: Partial<StructuredResponseInput> = {}): StructuredResponseInput {
  return {
    apiKey: 'fixture-key',
    model: 'gpt-5-mini',
    system: 'Return the requested object.',
    user: 'Say hello.',
    name: 'fixture_answer',
    schema,
    maxRetries: 0,
    fetchImpl,
    ...extra
  };
}

function streamEvents(terminal?: Record<string, unknown>) {
  return [
    { type: 'response.created', response: response('', { status: 'in_progress', usage: null }) },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'hidden reasoning' },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: '{"answer":' },
    { type: 'response.output_text.delta', output_index: 1, content_index: 0, delta: '"Hello"}' },
    ...(terminal ? [terminal] : [])
  ];
}

test('structured response uses the Responses endpoint and preserves schema, reasoning, metadata and usage', async () => {
  const http = fixture([() => jsonResponse(response())]);
  const result = await requestStructuredResponse<{ answer: string }>(input(http.fetchImpl, {
    reasoningEffort: 'low', strict: true, verbosity: 'low'
  }));
  assert.deepEqual(result, {
    value: { answer: 'Hello' }, usage, responseId: 'resp_fixture', model: 'gpt-5-mini-2025-08-07'
  });
  assert.equal(http.requests.length, 1);
  assert.equal(http.requests[0].url.href, 'https://api.openai.com/v1/responses');
  assert.deepEqual(http.requests[0].body, {
    model: 'gpt-5-mini',
    input: [
      { type: 'message', role: 'developer', content: 'Return the requested object.' },
      { type: 'message', role: 'user', content: 'Say hello.' }
    ],
    text: { format: { type: 'json_schema', schema, name: 'fixture_answer', strict: true }, verbosity: 'low' },
    reasoning: { effort: 'low' },
    stream: false
  });
});

test('structured response distinguishes omitted strictness from false and omits optional model settings', async () => {
  for (const strict of [undefined, false]) {
    const http = fixture([() => jsonResponse(response())]);
    await requestStructuredResponse(input(http.fetchImpl, { strict }));
    const body = http.requests[0].body;
    assert.deepEqual(body.text, {
      format: { type: 'json_schema', schema, name: 'fixture_answer', ...(strict === false ? { strict: false } : {}) }
    });
    assert.equal(Object.hasOwn(body, 'reasoning'), false);
  }
  const http = fixture([() => jsonResponse(response())]);
  await requestStructuredResponse(input(http.fetchImpl, { reasoningEffort: 'none' }));
  assert.deepEqual(http.requests[0].body.reasoning, { effort: 'none' });
});

test('structured response falls back to requested model and nullable response ID when metadata is absent', async () => {
  const http = fixture([() => jsonResponse(response(outputText, { id: undefined, model: undefined }))]);
  const result = await requestStructuredResponse(input(http.fetchImpl));
  assert.equal(result.model, 'gpt-5-mini');
  assert.equal(result.responseId, null);
});

test('structured response rejects empty, malformed and non-object JSON without retrying generation', async () => {
  for (const text of ['', '{"answer":', 'null', '[]', '"hello"', '1']) {
    const http = fixture([() => jsonResponse(response(text))]);
    await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { maxRetries: 2 })));
    assert.equal(http.requests.length, 1, `unexpected retry for ${JSON.stringify(text)}`);
  }
});

test('structured response applies only the caller retry budget to transient HTTP errors', async () => {
  for (const maxRetries of [0, 2]) {
    const http = fixture([() => jsonResponse({ error: { message: 'temporary failure', type: 'server_error' } }, 500)]);
    await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { maxRetries })));
    assert.equal(http.requests.length, maxRetries + 1);
  }
  const http = fixture([
    () => jsonResponse({ error: { message: 'temporary failure', type: 'server_error' } }, 500),
    () => jsonResponse(response())
  ]);
  assert.deepEqual((await requestStructuredResponse(input(http.fetchImpl, { maxRetries: 2 }))).value, { answer: 'Hello' });
  assert.equal(http.requests.length, 2);
});

test('structured response never retries permanent HTTP errors', async () => {
  const http = fixture([() => jsonResponse({ error: { message: 'bad schema', type: 'invalid_request_error' } }, 400)]);
  await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { maxRetries: 2 })));
  assert.equal(http.requests.length, 1);
});

test('structured response preserves SDK retries for conflict and rate-limit responses', async () => {
  for (const status of [409, 429]) {
    const http = fixture([
      () => jsonResponse({ error: { message: 'try again', type: 'api_error' } }, status),
      () => jsonResponse(response())
    ]);
    await requestStructuredResponse(input(http.fetchImpl, { maxRetries: 2 }));
    assert.equal(http.requests.length, 2);
  }
});

test('structured response respects the provider no-retry header', async () => {
  const http = fixture([() => new Response(JSON.stringify({ error: { message: 'do not retry' } }), {
    status: 500, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' }
  })]);
  await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { maxRetries: 2 })));
  assert.equal(http.requests.length, 1);
});

test('structured response preserves missing token details as unknown', async () => {
  const http = fixture([() => jsonResponse(response(outputText, {
    usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
  }))]);
  assert.deepEqual((await requestStructuredResponse(input(http.fetchImpl))).usage, {
    input_tokens: 2, output_tokens: 3, total_tokens: 5,
    input_tokens_details: {}, output_tokens_details: {}
  });
});

test('structured response reports absent provider usage as null', async () => {
  const http = fixture([() => jsonResponse(response(outputText, { usage: null }))]);
  assert.equal((await requestStructuredResponse(input(http.fetchImpl))).usage, null);
});

test('structured streaming applies the same caller retry budget before receiving content', async () => {
  for (const maxRetries of [0, 2]) {
    const http = fixture([() => jsonResponse({ error: { message: 'temporary failure' } }, 500)]);
    await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { maxRetries, onText() {} })));
    assert.equal(http.requests.length, maxRetries + 1);
  }
});

test('structured streaming emits accumulated raw text, excludes reasoning and isolates preview errors', async () => {
  const http = fixture([() => sseResponse(streamEvents({ type: 'response.completed', response: response() }))]);
  const previews: string[] = [];
  const result = await requestStructuredResponse(input(http.fetchImpl, {
    strict: true,
    verbosity: 'low',
    reasoningEffort: 'low',
    onText(text) { previews.push(text); throw new Error('observer failed'); }
  }));
  assert.deepEqual(previews, ['{"answer":', outputText]);
  assert.deepEqual(result, {
    value: { answer: 'Hello' }, usage, responseId: 'resp_fixture', model: 'gpt-5-mini-2025-08-07'
  });
  assert.equal(http.requests.length, 1);
  assert.equal(http.requests[0].body.stream, true);
  assert.deepEqual(http.requests[0].body.text, {
    format: { type: 'json_schema', schema, name: 'fixture_answer', strict: true }, verbosity: 'low'
  });
  assert.deepEqual(http.requests[0].body.reasoning, { effort: 'low' });
});

test('structured streaming does not accept valid accumulated JSON without successful completion', async () => {
  const cases = [
    undefined,
    { type: 'response.failed', response: response(outputText, { status: 'failed', error: { code: 'server_error', message: 'failed' } }) },
    { type: 'response.incomplete', response: response(outputText, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) },
    { type: 'error', code: 'server_error', message: 'stream error', param: null },
    { type: 'response.completed', response: response(outputText, { status: 'incomplete' }) }
  ];
  for (const terminal of cases) {
    const previews: string[] = [];
    const http = fixture([() => sseResponse(streamEvents(terminal))]);
    await assert.rejects(requestStructuredResponse(input(http.fetchImpl, {
      maxRetries: 2, onText: text => { previews.push(text); }
    })));
    assert.equal(previews.at(-1), outputText);
    assert.equal(http.requests.length, 1, 'never retry a stream after receiving content');
  }
});

test('structured streaming rejects malformed final JSON even with a completed terminal event', async () => {
  const http = fixture([() => sseResponse([
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '{"answer":' },
    { type: 'response.completed', response: response('{"answer":') }
  ])]);
  await assert.rejects(requestStructuredResponse(input(http.fetchImpl, { onText() {} })), /openai_invalid_structured_output/);
});

test('structured streaming reports absent usage as null and preserves zero token details', async () => {
  for (const expectedUsage of [null, {
    input_tokens: 1, input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2
  }]) {
    const http = fixture([() => sseResponse(streamEvents({
      type: 'response.completed', response: response(outputText, { usage: expectedUsage })
    }))]);
    assert.deepEqual((await requestStructuredResponse(input(http.fetchImpl, { onText() {} }))).usage, expectedUsage);
  }
});
