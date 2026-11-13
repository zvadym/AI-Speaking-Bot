import { createSupportGraph } from '../../ai/graphs/support.js';
import type { BotHandler } from '../handler-registry.js';
import { BOT_RUNTIME_HANDLER_VERSIONS } from '../route-flags.js';
import type { SupportRoute } from '../support.js';

export function createSupportCallbackHandlers(
  dependencies: Parameters<typeof createSupportGraph>[0]
): BotHandler[] {
  const graph = createSupportGraph(dependencies);
  const routes: SupportRoute[] = [
    'callback.transcript_translate', 'callback.translate', 'callback.hints', 'callback.vocab'
  ];
  return routes.map((route): BotHandler => ({
    route,
    version: BOT_RUNTIME_HANDLER_VERSIONS[route],
    async execute(update) {
      const result = await graph.invoke({ update });
      return result.outcome;
    }
  }));
}
