export function parseImmediateAckEnabledBotKeys(
  raw: unknown,
  knownBotKeys: readonly string[]
): ReadonlySet<string> {
  const known = new Set(
    knownBotKeys
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
  );
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return new Set();
  if (value === '*') return new Set(known);

  const enabled = new Set<string>();
  for (const item of value.split(/[\s,]+/gu)) {
    const botKey = item.trim();
    if (!botKey) continue;
    if (!known.has(botKey)) throw new Error(`unknown_immediate_ack_bot_key:${botKey}`);
    enabled.add(botKey);
  }
  return enabled;
}
