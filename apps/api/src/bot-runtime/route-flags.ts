import { normalizeBotKey } from '../shared/normalization.js';
import { ROUTES, type Route } from './contracts.js';

export const BOT_RUNTIME_HANDLER_VERSIONS = {
  'ignore': 1,
  'guard.private_only': 1,
  'guard.bot_sender': 1,
  'callback.level': 1,
  'callback.reply': 1,
  'command.start': 1,
  'command.voice': 1,
  'command.lang': 1,
  'command.level': 1,
  'command.stats': 1,
  'command.xp': 1,
  'command.topic': 1,
  'command.feedback': 1,
  'command.unknown': 1,
  'reply_keyboard.voice_toggle': 1,
  'pending_feedback.text': 1,
  'pending_feedback.unsupported': 1,
  'message.unsupported': 1
} as const satisfies Partial<Record<Route, number>>;

export type ImplementedBotRuntimeRoute = keyof typeof BOT_RUNTIME_HANDLER_VERSIONS;
export type BotRuntimeRouteFlags = ReadonlyMap<string, ReadonlySet<ImplementedBotRuntimeRoute>>;

const routeSet = new Set<string>(ROUTES);
const implementedRouteSet = new Set<string>(Object.keys(BOT_RUNTIME_HANDLER_VERSIONS));

function invalidFlags(reason: string): never {
  throw new Error(`Invalid BOT_RUNTIME_ROUTE_FLAGS_JSON: ${reason}`);
}

export function parseBotRuntimeRouteFlags(
  raw: unknown,
  knownBotKeys: Iterable<string>
): BotRuntimeRouteFlags {
  const value = String(raw ?? '').trim();
  if (!value) return new Map();
  if (value.length > 20_000) invalidFlags('value is too large');

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidFlags('expected valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalidFlags('expected an object mapping bot keys to route arrays');
  }

  const known = new Set(
    [...knownBotKeys]
      .map((botKey) => normalizeBotKey(botKey))
      .filter((botKey): botKey is string => Boolean(botKey))
  );
  const result = new Map<string, ReadonlySet<ImplementedBotRuntimeRoute>>();

  for (const [rawBotKey, rawRoutes] of Object.entries(parsed as Record<string, unknown>)) {
    const botKey = normalizeBotKey(rawBotKey);
    if (!botKey || !known.has(botKey)) invalidFlags(`unknown bot key ${JSON.stringify(rawBotKey)}`);
    if (result.has(botKey)) invalidFlags(`duplicate normalized bot key ${JSON.stringify(botKey)}`);
    if (!Array.isArray(rawRoutes)) invalidFlags(`${botKey} must map to an array`);

    const routes = new Set<ImplementedBotRuntimeRoute>();
    for (const rawRoute of rawRoutes) {
      if (typeof rawRoute !== 'string' || !routeSet.has(rawRoute)) {
        invalidFlags(`${botKey} contains unknown route ${JSON.stringify(rawRoute)}`);
      }
      if (!implementedRouteSet.has(rawRoute)) {
        invalidFlags(`${botKey} enables unimplemented route ${JSON.stringify(rawRoute)}`);
      }
      routes.add(rawRoute as ImplementedBotRuntimeRoute);
    }

    result.set(botKey, routes);
  }

  return result;
}

export function isBotRuntimeRouteEnabled(
  flags: BotRuntimeRouteFlags,
  botKey: string,
  route: Route
): route is ImplementedBotRuntimeRoute {
  return flags.get(botKey)?.has(route as ImplementedBotRuntimeRoute) === true;
}

export function handlerVersionForRoute(route: Route): number | null {
  return BOT_RUNTIME_HANDLER_VERSIONS[route as ImplementedBotRuntimeRoute] ?? null;
}
