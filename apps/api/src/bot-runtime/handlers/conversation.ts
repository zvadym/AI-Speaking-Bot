import { createTextConversationGraph } from '../../ai/graphs/conversation.js';
import type { BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';

export function createTextConversationHandler(
  dependencies: Parameters<typeof createTextConversationGraph>[0]
): BotHandler<'message.text'> {
  const graph = createTextConversationGraph(dependencies);
  return {
    route: 'message.text',
    version: BOT_RUNTIME_HANDLER_VERSIONS['message.text'],
    async execute(update) {
      const result = await graph.invoke({ update });
      return result.outcome;
    }
  };
}
