/** Responses HTTP fixtures shared by callers using the real LangChain transport. */
export async function requestBody(input: string | URL | Request, init?: RequestInit): Promise<Record<string, any>> {
  return JSON.parse(typeof init?.body === 'string' ? init.body : await (input as Request).text());
}

export function responsePayload(value: Record<string, unknown>, model = 'test-model'): Record<string, unknown> {
  const output = value.output || [{
    type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: value.output_text, annotations: [] }]
  }];
  return {
    id: 'resp_fixture', object: 'response', created_at: 1,
    status: 'completed', model, error: null, incomplete_details: null,
    ...value,
    output: (output as Record<string, unknown>[]).map(item => ({
      id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', ...item,
      content: (item.content as Record<string, unknown>[]).map(part => ({ annotations: [], ...part }))
    }))
  };
}

export function structuredResponseFetch(
  reply: (body: Record<string, any>) => Record<string, unknown> | Promise<Record<string, unknown>>
): typeof fetch {
  return async (input, init) => {
    const body = await requestBody(input, init);
    return new Response(JSON.stringify(responsePayload(await reply(body), body.model)), {
      headers: { 'content-type': 'application/json' }
    });
  };
}

export function sseResponse(events: object[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' }
  });
}
