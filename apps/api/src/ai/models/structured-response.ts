import { ChatOpenAI, type ChatOpenAICallOptions } from '@langchain/openai';
import type { UsageMetadata } from '@langchain/core/messages';

export interface StructuredResponseInput {
  apiKey: string;
  model: string;
  reasoningEffort?: string;
  system: string;
  user: string;
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  verbosity?: 'low';
  maxRetries: number;
  fetchImpl?: typeof fetch;
  onText?: (text: string) => void;
}

export interface StructuredResponseResult<T> {
  value: T;
  usage: Record<string, unknown> | null;
  responseId: string | null;
  model: string;
}

function providerUsage(usage: UsageMetadata | undefined): Record<string, unknown> | null {
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens,
    input_tokens_details: {
      ...(usage.input_token_details?.cache_read !== undefined ? { cached_tokens: usage.input_token_details.cache_read } : {})
    },
    output_tokens: usage.output_tokens,
    output_tokens_details: {
      ...(usage.output_token_details?.reasoning !== undefined ? { reasoning_tokens: usage.output_token_details.reasoning } : {})
    },
    total_tokens: usage.total_tokens
  };
}

/** One Responses request; callers own telemetry, prompt rendering and domain validation. */
export async function requestStructuredResponse<T>(input: StructuredResponseInput): Promise<StructuredResponseResult<T>> {
  const model = new ChatOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    useResponsesApi: true,
    // Keep SDK HTTP retries (including 409), without retrying JSON parsing in LangChain.
    maxRetries: 0,
    configuration: {
      maxRetries: input.maxRetries,
      ...(input.fetchImpl ? { fetch: input.fetchImpl } : {})
    }
  });
  const messages = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.user }
  ];
  const options: Partial<ChatOpenAICallOptions> = {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.name,
        schema: input.schema,
        ...(input.strict !== undefined ? { strict: input.strict } : {})
      }
    },
    ...(input.reasoningEffort ? {
      reasoning: { effort: input.reasoningEffort as NonNullable<ChatOpenAICallOptions['reasoning']>['effort'] }
    } : {}),
    ...(input.verbosity ? { verbosity: input.verbosity } : {})
  };

  let message;
  let hasUsage = true;
  if (input.onText) {
    const stream = model.streamEvents(messages, options);
    let source = '';
    let completed = false;
    for await (const event of stream) {
      if (event.event === 'content-block-delta' && event.delta.type === 'text-delta') {
        source += event.delta.text;
        try { input.onText(source); } catch { /* Preview observers must not fail inference. */ }
      } else if (event.event === 'provider' && (event.name === 'response.failed' || event.name === 'error')) {
        throw new Error('openai_stream_failed');
      } else if (event.event === 'message-finish') {
        // LangChain also emits message-finish at EOF without a provider terminal event.
        if (event.reason === 'length' || event.responseMetadata?.status === 'incomplete') {
          throw new Error('openai_stream_failed');
        }
        completed = event.responseMetadata?.status === 'completed';
      }
    }
    if (!completed) throw new Error('openai_stream_incomplete');
    message = await stream;
  } else {
    message = await model.invoke(messages, {
      ...options,
      callbacks: [{
        handleLLMEnd(output) {
          // The Responses converter invents zero usage when the provider omits it.
          hasUsage = output.llmOutput?.estimatedTokenUsage != null;
        }
      }]
    });
  }

  let value: unknown;
  try { value = JSON.parse(message.text); } catch {
    throw new Error('openai_invalid_structured_output');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('openai_invalid_structured_output');
  }
  const metadata = message.response_metadata;
  return {
    value: value as T,
    usage: providerUsage(hasUsage ? message.usage_metadata : undefined),
    responseId: typeof metadata.id === 'string' ? metadata.id : null,
    model: typeof metadata.model === 'string' ? metadata.model : input.model
  };
}
