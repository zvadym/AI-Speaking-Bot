export const MODEL_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const;

export type ModelReasoningEffort = typeof MODEL_REASONING_EFFORTS[number];

export interface BotModelPolicy {
  conversationModel: string;
  conversationReasoningEffort?: ModelReasoningEffort;
  supportModel: string;
  supportReasoningEffort?: ModelReasoningEffort;
}

export type BotModelPolicyOverride = Partial<BotModelPolicy>;

const ALLOWED_FIELDS = new Set<keyof BotModelPolicy>([
  'conversationModel',
  'conversationReasoningEffort',
  'supportModel',
  'supportReasoningEffort'
]);
const REASONING_EFFORTS = new Set<string>(MODEL_REASONING_EFFORTS);

function parseModel(value: unknown, location: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) {
    throw new Error(`Invalid model at ${location}`);
  }
  return value.trim();
}

export function parseModelReasoningEffort(value: unknown, location: string): ModelReasoningEffort | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!REASONING_EFFORTS.has(normalized)) {
    throw new Error(`Invalid reasoning effort at ${location}`);
  }
  return normalized as ModelReasoningEffort;
}

export function parseBotModelPolicyOverrides(
  value: string | undefined,
  configuredBotKeys: string[]
): Record<string, BotModelPolicyOverride> {
  const raw = String(value || '').trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid BOT_MODEL_POLICY_JSON: expected JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid BOT_MODEL_POLICY_JSON: expected an object');
  }

  const configured = new Set(configuredBotKeys.map((key) => key.trim().toLowerCase()));
  const result: Record<string, BotModelPolicyOverride> = {};
  for (const [rawBotKey, rawOverride] of Object.entries(parsed)) {
    const botKey = rawBotKey.trim().toLowerCase();
    if (!configured.has(botKey)) {
      throw new Error(`Invalid BOT_MODEL_POLICY_JSON: unknown bot key ${rawBotKey}`);
    }
    if (!rawOverride || typeof rawOverride !== 'object' || Array.isArray(rawOverride)) {
      throw new Error(`Invalid BOT_MODEL_POLICY_JSON: ${botKey} must be an object`);
    }
    const override: BotModelPolicyOverride = {};
    for (const [field, fieldValue] of Object.entries(rawOverride)) {
      if (!ALLOWED_FIELDS.has(field as keyof BotModelPolicy)) {
        throw new Error(`Invalid BOT_MODEL_POLICY_JSON: unknown field ${botKey}.${field}`);
      }
      if (field === 'conversationModel' || field === 'supportModel') {
        override[field] = parseModel(fieldValue, `${botKey}.${field}`);
      } else if (field === 'conversationReasoningEffort' || field === 'supportReasoningEffort') {
        override[field] = parseModelReasoningEffort(fieldValue, `${botKey}.${field}`);
      }
    }
    if (!Object.keys(override).length) {
      throw new Error(`Invalid BOT_MODEL_POLICY_JSON: ${botKey} override is empty`);
    }
    result[botKey] = override;
  }
  return result;
}

export function resolveBotModelPolicy(
  defaults: BotModelPolicy,
  override: BotModelPolicyOverride | undefined
): BotModelPolicy {
  return { ...defaults, ...(override || {}) };
}
