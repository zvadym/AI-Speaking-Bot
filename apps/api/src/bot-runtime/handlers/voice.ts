import { createVoiceConversationGraph } from '../../ai/graphs/conversation.js';
import type { BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import { createFeedbackMessageHandler } from './feedback.js';

export function createVoiceConversationHandler(
  dependencies: Parameters<typeof createVoiceConversationGraph>[0]
): BotHandler<'message.voice'> {
  const graph = createVoiceConversationGraph(dependencies);
  return {
    route: 'message.voice',
    version: BOT_RUNTIME_HANDLER_VERSIONS['message.voice'],
    async execute(update) {
      const result = await graph.invoke({ update });
      return result.outcome;
    }
  };
}

export function createVoiceFeedbackHandler(deps: Parameters<typeof createFeedbackMessageHandler>[1]) {
  return createFeedbackMessageHandler('pending_feedback.voice', deps);
}
