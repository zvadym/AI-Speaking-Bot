import type { Pool, PoolClient } from 'pg';

type UnknownRecord = Record<string, unknown>;

export type OnboardingScenario = 'about_self' | 'daily_life' | 'travel' | 'freeform';
export type OnboardingInputMode = 'voice' | 'text';
export type OnboardingState = 'choose_scenario' | 'await_practice' | 'completed';
export type SuggestedLevel = 'a1' | 'a2' | 'b1' | 'b2' | 'c1';

export interface OnboardingSession extends UnknownRecord {
  chat_id: string | number;
  bot_key: string;
  version: number;
  state: OnboardingState;
  scenario: OnboardingScenario | null;
  first_input_mode: OnboardingInputMode | null;
  suggested_level: SuggestedLevel | null;
  completion_decision_id: string | null;
  last_start_update_id: string | number | null;
  started_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
}

export interface OnboardingScenarioLocale {
  button: string;
  prompt: string;
  example: string;
}

export interface OnboardingLocale {
  welcome: string;
  choose_scenario: string;
  voice_instruction: string;
  text_instruction: string;
  success: string;
  voice_input_header: string;
  text_input_header: string;
  level_suggestion: string;
  already_completed: string;
  retry_corrected: string;
  continue_prompt: string;
  errors: {
    expired: string;
    retry_voice: string;
    retry_delivery: string;
  };
  buttons: {
    use_text: string;
    change_scenario: string;
    confirm_level: string;
    choose_level: string;
    retry: string;
    continue: string;
  };
  scenarios: Record<Exclude<OnboardingScenario, 'freeform'>, OnboardingScenarioLocale>;
}

const SCENARIOS = ['about_self', 'daily_life', 'travel'] as const;
const LEVELS = new Set<SuggestedLevel>(['a1', 'a2', 'b1', 'b2', 'c1']);

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function nestedText(parent: UnknownRecord, key: string): string {
  return text(parent[key]);
}

export function normalizeSuggestedLevel(value: unknown): SuggestedLevel | null {
  const level = text(value).toLowerCase() as SuggestedLevel;
  return LEVELS.has(level) ? level : null;
}

export function getOnboardingLocale(localeRaw: unknown): OnboardingLocale | null {
  const root = asObject(asObject(localeRaw).onboarding_v2);
  const errors = asObject(root.errors);
  const buttons = asObject(root.buttons);
  const scenarios = asObject(root.scenarios);
  const parsedScenarios = {} as OnboardingLocale['scenarios'];
  for (const scenario of SCENARIOS) {
    const value = asObject(scenarios[scenario]);
    const parsed = {
      button: nestedText(value, 'button'),
      prompt: nestedText(value, 'prompt'),
      example: nestedText(value, 'example')
    };
    if (!parsed.button || !parsed.prompt || !parsed.example) return null;
    parsedScenarios[scenario] = parsed;
  }

  const parsed: OnboardingLocale = {
    welcome: nestedText(root, 'welcome'),
    choose_scenario: nestedText(root, 'choose_scenario'),
    voice_instruction: nestedText(root, 'voice_instruction'),
    text_instruction: nestedText(root, 'text_instruction'),
    success: nestedText(root, 'success'),
    voice_input_header: nestedText(root, 'voice_input_header'),
    text_input_header: nestedText(root, 'text_input_header'),
    level_suggestion: nestedText(root, 'level_suggestion'),
    already_completed: nestedText(root, 'already_completed'),
    retry_corrected: nestedText(root, 'retry_corrected'),
    continue_prompt: nestedText(root, 'continue_prompt'),
    errors: {
      expired: nestedText(errors, 'expired'),
      retry_voice: nestedText(errors, 'retry_voice'),
      retry_delivery: nestedText(errors, 'retry_delivery')
    },
    buttons: {
      use_text: nestedText(buttons, 'use_text'),
      change_scenario: nestedText(buttons, 'change_scenario'),
      confirm_level: nestedText(buttons, 'confirm_level'),
      choose_level: nestedText(buttons, 'choose_level'),
      retry: nestedText(buttons, 'retry'),
      continue: nestedText(buttons, 'continue')
    },
    scenarios: parsedScenarios
  };

  const required = [
    parsed.welcome,
    parsed.choose_scenario,
    parsed.voice_instruction,
    parsed.text_instruction,
    parsed.success,
    parsed.voice_input_header,
    parsed.text_input_header,
    parsed.level_suggestion,
    parsed.already_completed,
    parsed.retry_corrected,
    parsed.continue_prompt,
    ...Object.values(parsed.errors),
    ...Object.values(parsed.buttons)
  ];
  return required.every(Boolean) ? parsed : null;
}

export function validateOnboardingLocale(localeRaw: unknown): string[] {
  const locale = getOnboardingLocale(localeRaw);
  if (!locale) return ['locale.onboarding_v2 is missing required localized fields'];
  const errors: string[] = [];
  const allowedPlaceholders = new Set(['first_name', 'suggested_level']);
  const values: Array<[string, string]> = [
    ['welcome', locale.welcome],
    ['choose_scenario', locale.choose_scenario],
    ['level_suggestion', locale.level_suggestion],
    ['buttons.confirm_level', locale.buttons.confirm_level]
  ];
  for (const [key, value] of values) {
    for (const match of value.matchAll(/\{([a-z_]+)\}/giu)) {
      if (!allowedPlaceholders.has(match[1])) errors.push(`${key} has unknown placeholder {${match[1]}}`);
    }
  }
  if (!locale.welcome.includes('{first_name}')) errors.push('welcome must include {first_name}');
  if (!locale.level_suggestion.includes('{suggested_level}')) {
    errors.push('level_suggestion must include {suggested_level}');
  }
  if (!locale.buttons.confirm_level.includes('{suggested_level}')) {
    errors.push('buttons.confirm_level must include {suggested_level}');
  }
  return errors;
}

export function renderOnboardingText(
  template: string,
  values: { first_name?: string | null; suggested_level?: string | null }
): string {
  return template.replace(/\{(first_name|suggested_level)\}/gu, (_match, key: string) => {
    if (key === 'first_name') return text(values.first_name) || 'there';
    return text(values.suggested_level).toUpperCase();
  });
}

export function buildOnboardingScenarioPicker(locale: OnboardingLocale) {
  return {
    inline_keyboard: [
      [
        { text: locale.scenarios.about_self.button, callback_data: 'onb:scenario:about_self' },
        { text: locale.scenarios.daily_life.button, callback_data: 'onb:scenario:daily_life' }
      ],
      [{ text: locale.scenarios.travel.button, callback_data: 'onb:scenario:travel' }]
    ]
  };
}

export function buildOnboardingWelcome(locale: OnboardingLocale, firstName: string | null): string {
  return [
    renderOnboardingText(locale.welcome, { first_name: firstName }),
    locale.choose_scenario
  ].join('\n\n');
}

export function buildOnboardingPracticeCard(
  locale: OnboardingLocale,
  scenario: Exclude<OnboardingScenario, 'freeform'>,
  mode: OnboardingInputMode = 'voice'
): string {
  const item = locale.scenarios[scenario];
  return [
    item.button,
    '',
    item.prompt,
    '',
    item.example,
    '',
    mode === 'text' ? locale.text_instruction : locale.voice_instruction
  ].join('\n');
}

export function buildOnboardingPracticeMarkup(locale: OnboardingLocale) {
  return {
    inline_keyboard: [
      [{ text: locale.buttons.use_text, callback_data: 'onb:mode:text' }],
      [{ text: locale.buttons.change_scenario, callback_data: 'onb:scenario:choose' }]
    ]
  };
}

export function buildOnboardingCompletionMarkup(
  locale: OnboardingLocale,
  suggestedLevel: SuggestedLevel | null
) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (suggestedLevel) {
    rows.push([
      {
        text: renderOnboardingText(locale.buttons.confirm_level, { suggested_level: suggestedLevel }),
        callback_data: `onb:level:${suggestedLevel}`
      },
      { text: locale.buttons.choose_level, callback_data: 'onb:level:choose' }
    ]);
  }
  rows.push([
    { text: locale.buttons.retry, callback_data: 'onb:bonus:retry' },
    { text: locale.buttons.continue, callback_data: 'onb:bonus:continue' }
  ]);
  return { inline_keyboard: rows };
}

export async function loadOnboardingSession(
  pool: Pick<Pool, 'query'>,
  chatId: number,
  botKey: string
): Promise<OnboardingSession | null> {
  const { rows } = await pool.query<OnboardingSession>(
    `SELECT *
       FROM bot_onboarding_sessions
      WHERE chat_id = $1
        AND bot_key = $2
      LIMIT 1`,
    [chatId, botKey]
  );
  return rows[0] || null;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function recordEvent(
  client: Pick<PoolClient, 'query'>,
  input: {
    chatId: number;
    botKey: string;
    actionType: string;
    idempotencyKey: string;
    properties?: UnknownRecord;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO action_events (
       chat_id, bot_key, action_type, source, idempotency_key, properties, occurred_at
     ) VALUES ($1, $2, $3, 'bot_runtime', $4, $5::jsonb, NOW())
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [
      input.chatId,
      input.botKey,
      input.actionType,
      input.idempotencyKey,
      JSON.stringify(input.properties || {})
    ]
  );
}

export async function selectOnboardingScenario(
  pool: Pool,
  input: { chatId: number; botKey: string; scenario: Exclude<OnboardingScenario, 'freeform'> }
): Promise<OnboardingSession | null> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<OnboardingSession>(
      `UPDATE bot_onboarding_sessions
          SET state = 'await_practice',
              scenario = $3,
              first_input_mode = NULL,
              updated_at = NOW()
        WHERE chat_id = $1
          AND bot_key = $2
          AND state <> 'completed'
      RETURNING *`,
      [input.chatId, input.botKey, input.scenario]
    );
    const session = rows[0] || null;
    if (session) {
      await recordEvent(client, {
        chatId: input.chatId,
        botKey: input.botKey,
        actionType: 'onboarding_scenario_selected',
        idempotencyKey: `onboarding_scenario_selected:${input.chatId}:${input.botKey}:v${session.version}:${input.scenario}`,
        properties: { scenario: input.scenario, version: session.version }
      });
    }
    return session;
  });
}

export async function resetOnboardingScenario(
  pool: Pool,
  chatId: number,
  botKey: string
): Promise<OnboardingSession | null> {
  const { rows } = await pool.query<OnboardingSession>(
    `UPDATE bot_onboarding_sessions
        SET state = 'choose_scenario',
            scenario = NULL,
            first_input_mode = NULL,
            updated_at = NOW()
      WHERE chat_id = $1
        AND bot_key = $2
        AND state <> 'completed'
    RETURNING *`,
    [chatId, botKey]
  );
  return rows[0] || null;
}

export async function prepareOnboardingPractice(
  pool: Pool,
  input: { chatId: number; botKey: string; inputMode: OnboardingInputMode }
): Promise<OnboardingSession | null> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<OnboardingSession>(
      `UPDATE bot_onboarding_sessions
          SET state = 'await_practice',
              scenario = COALESCE(scenario, 'freeform'),
              first_input_mode = COALESCE(first_input_mode, $3),
              updated_at = NOW()
        WHERE chat_id = $1
          AND bot_key = $2
          AND state <> 'completed'
      RETURNING *`,
      [input.chatId, input.botKey, input.inputMode]
    );
    const session = rows[0] || null;
    if (session) {
      await recordEvent(client, {
        chatId: input.chatId,
        botKey: input.botKey,
        actionType: 'onboarding_practice_sent',
        idempotencyKey: `onboarding_practice_sent:${input.chatId}:${input.botKey}:v${session.version}`,
        properties: {
          scenario: session.scenario,
          input_mode: input.inputMode,
          version: session.version
        }
      });
    }
    return session;
  });
}

export async function completeOnboardingSession(
  pool: Pool,
  input: {
    chatId: number;
    botKey: string;
    suggestedLevel: SuggestedLevel | null;
    decisionId: string;
    responseStyle?: 'custom' | 'repeated_example' | 'unknown';
  }
): Promise<OnboardingSession | null> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<OnboardingSession>(
      `UPDATE bot_onboarding_sessions
          SET state = 'completed',
              suggested_level = $3,
              completion_decision_id = $4,
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
        WHERE chat_id = $1
          AND bot_key = $2
          AND state <> 'completed'
      RETURNING *`,
      [input.chatId, input.botKey, input.suggestedLevel, input.decisionId]
    );
    const session = rows[0] || await loadOnboardingSession(client as Pick<Pool, 'query'>, input.chatId, input.botKey);
    if (session?.state === 'completed') {
      await recordEvent(client, {
        chatId: input.chatId,
        botKey: input.botKey,
        actionType: 'onboarding_completed',
        idempotencyKey: `onboarding_completed:${input.chatId}:${input.botKey}:v${session.version}`,
        properties: {
          scenario: session.scenario,
          input_mode: session.first_input_mode,
          version: session.version,
          response_style: input.responseStyle || 'unknown',
          suggested_level: session.suggested_level
        }
      });
    }
    return session;
  });
}

export async function confirmOnboardingLevel(
  pool: Pool,
  input: { chatId: number; botKey: string; level: SuggestedLevel }
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const session = await loadOnboardingSession(client as Pick<Pool, 'query'>, input.chatId, input.botKey);
    if (!session || session.state !== 'completed' || session.suggested_level !== input.level) return false;
    await client.query(
      `UPDATE user_bots
          SET level = $3,
              updated_at = NOW()
        WHERE chat_id = $1
          AND bot_key = $2`,
      [input.chatId, input.botKey, input.level]
    );
    await recordEvent(client, {
      chatId: input.chatId,
      botKey: input.botKey,
      actionType: 'onboarding_level_confirmed',
      idempotencyKey: `onboarding_level_confirmed:${input.chatId}:${input.botKey}:v${session.version}`,
      properties: { level: input.level, version: session.version }
    });
    return true;
  });
}

export async function recordOnboardingBonus(
  pool: Pool,
  input: { chatId: number; botKey: string; action: 'retry' | 'continue' }
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const session = await loadOnboardingSession(client as Pick<Pool, 'query'>, input.chatId, input.botKey);
    if (!session || session.state !== 'completed') return false;
    await recordEvent(client, {
      chatId: input.chatId,
      botKey: input.botKey,
      actionType: 'onboarding_bonus_selected',
      idempotencyKey: `onboarding_bonus_selected:${input.chatId}:${input.botKey}:v${session.version}:${input.action}`,
      properties: { action: input.action, version: session.version }
    });
    return true;
  });
}
