#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { loadBotConfigs } from '../src/bot-configs.js';
import { createBotAiClient, type ConversationAiResult } from '../src/bot-runtime/bot-ai.js';
import type { LlmCallEvent } from '../src/bot-runtime/llm-telemetry.js';
import {
  percentile,
  validateConversationEvalFixture,
  validateConversationEvalResult,
  type ConversationEvalCase,
  type ConversationEvalFixture
} from '../src/bot-runtime/model-eval.js';

type VariantId = 'baseline' | 'luna_none' | 'luna_low';
type BlindLabel = 'A' | 'B' | 'C';

interface ModelVariant {
  id: VariantId;
  model: string;
  reasoningEffort?: string;
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
}

interface VariantRun {
  variantId: VariantId;
  model: string;
  reasoningEffort: string | null;
  output: ConversationAiResult | null;
  durationMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number;
  hardErrors: string[];
  callError: string | null;
}

interface JudgeAssessment {
  label: BlindLabel;
  target_language_fidelity: number;
  correction_accuracy: number;
  level_fit: number;
  conversational_usefulness: number;
  instruction_compliance: number;
  critical_failure: boolean;
  critical_reason: string;
}

interface JudgeComparison {
  left_label: BlindLabel;
  right_label: BlindLabel;
  winner: BlindLabel | 'tie';
  reason: string;
}

interface JudgeResult {
  case_id: string;
  assessments: JudgeAssessment[];
  comparisons: JudgeComparison[];
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(currentDir, '..');
const rootDir = path.resolve(apiDir, '../..');
dotenv.config({ path: path.join(rootDir, 'deploy/.env.api') });

const fixturePath = path.join(apiDir, 'evals/conversation-balanced-v1.json');
const outputDir = path.join(rootDir, 'docs/model-evals');
const reportJsonPath = path.join(outputDir, 'conversation-balanced-v1-report.json');
const reportMarkdownPath = path.join(outputDir, 'conversation-balanced-v1-report.md');
const dryRun = process.argv.includes('--dry-run');
const judgeModel = process.env.MODEL_EVAL_JUDGE_MODEL?.trim() || 'gpt-5.6-terra';

const variants: ModelVariant[] = [
  {
    id: 'baseline',
    model: 'gpt-5.4',
    inputUsd: 2.50,
    cachedInputUsd: 0.25,
    outputUsd: 15.00
  },
  {
    id: 'luna_none',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'none',
    inputUsd: 1.00,
    cachedInputUsd: 0.10,
    outputUsd: 6.00
  },
  {
    id: 'luna_low',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    inputUsd: 1.00,
    cachedInputUsd: 0.10,
    outputUsd: 6.00
  }
];

const judgeRates = {
  inputUsd: 2.50,
  cachedInputUsd: 0.25,
  outputUsd: 15.00
};

function parseResponseText(response: unknown): string {
  const payload = response as Record<string, unknown>;
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  for (const itemRaw of Array.isArray(payload.output) ? payload.output : []) {
    const item = itemRaw as Record<string, unknown>;
    for (const partRaw of Array.isArray(item.content) ? item.content : []) {
      const part = partRaw as Record<string, unknown>;
      if (typeof part.text === 'string' && part.text.trim()) return part.text.trim();
    }
  }
  throw new Error('judge_empty_output');
}

function finiteToken(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function estimateCost(
  usage: { inputTokens?: number | null; cachedInputTokens?: number | null; outputTokens?: number | null },
  rates: { inputUsd: number; cachedInputUsd: number; outputUsd: number }
): number {
  const inputTokens = finiteToken(usage.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, finiteToken(usage.cachedInputTokens));
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = finiteToken(usage.outputTokens);
  return (
    uncachedInputTokens * rates.inputUsd
    + cachedInputTokens * rates.cachedInputUsd
    + outputTokens * rates.outputUsd
  ) / 1_000_000;
}

function rotate<T>(values: T[], offset: number): T[] {
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function qualityScore(assessment: JudgeAssessment): number {
  return (
    assessment.target_language_fidelity
    + assessment.correction_accuracy
    + assessment.level_fit
    + assessment.conversational_usefulness
    + assessment.instruction_compliance
  ) / 5;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function rounded(value: number, places = 4): number {
  return Number(value.toFixed(places));
}

function sanitizeError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return String(record.code || record.type || record.message || error || 'unknown_error')
    .replace(/\s+/gu, ' ')
    .slice(0, 300);
}

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['case_id', 'assessments', 'comparisons'],
  properties: {
    case_id: { type: 'string' },
    assessments: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'label',
          'target_language_fidelity',
          'correction_accuracy',
          'level_fit',
          'conversational_usefulness',
          'instruction_compliance',
          'critical_failure',
          'critical_reason'
        ],
        properties: {
          label: { type: 'string', enum: ['A', 'B', 'C'] },
          target_language_fidelity: { type: 'integer', minimum: 1, maximum: 5 },
          correction_accuracy: { type: 'integer', minimum: 1, maximum: 5 },
          level_fit: { type: 'integer', minimum: 1, maximum: 5 },
          conversational_usefulness: { type: 'integer', minimum: 1, maximum: 5 },
          instruction_compliance: { type: 'integer', minimum: 1, maximum: 5 },
          critical_failure: { type: 'boolean' },
          critical_reason: { type: 'string' }
        }
      }
    },
    comparisons: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['left_label', 'right_label', 'winner', 'reason'],
        properties: {
          left_label: { type: 'string', enum: ['A', 'B', 'C'] },
          right_label: { type: 'string', enum: ['A', 'B', 'C'] },
          winner: { type: 'string', enum: ['A', 'B', 'C', 'tie'] },
          reason: { type: 'string' }
        }
      }
    }
  }
};

const JUDGE_SYSTEM_PROMPT = `You are evaluating a production language-learning tutor.
Score each anonymous output independently from 1 (unacceptable) to 5 (excellent):
- target_language_fidelity: reply language and language-routing behavior are correct;
- correction_accuracy: mistakes are detected accurately, corrections preserve intent, and voice-like ASR is not over-corrected;
- level_fit: wording and correction depth fit the learner CEFR level;
- conversational_usefulness: the reply directly responds, is natural, concise, and advances the conversation without parroting;
- instruction_compliance: correction vs hint mode, pinned topic, base-language explanation, and formatting rules are respected.

Set critical_failure=true only for a wrong routing/language decision, a materially wrong or invented correction, failure to answer a direct question, or a serious pinned-topic violation. A small style preference is not critical.

For each requested anonymous pair, choose the materially better output or tie. Do not infer model identity. Evaluate only the supplied case and output. Return exactly the requested JSON schema.`;

async function runVariant(
  variant: ModelVariant,
  testCase: ConversationEvalCase,
  botConfigs: Record<string, Record<string, unknown>>
): Promise<VariantRun> {
  let event: LlmCallEvent | null = null;
  const botAi = createBotAiClient({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: variant.model,
    supportModel: variant.model,
    conversationReasoningEffort: variant.reasoningEffort,
    recordLlmCall: async (value) => { event = value; },
    getBotConfig: (botKey) => botConfigs[botKey] || null
  });

  try {
    const output = await botAi.respond({
      botKey: testCase.botKey,
      level: testCase.level,
      inputMode: testCase.inputMode,
      text: testCase.text,
      profileSummary: testCase.profileSummary,
      shortSummary: testCase.shortSummary,
      history: testCase.history,
      topic: testCase.topic,
      trace: { botKey: testCase.botKey, route: `eval.${testCase.id}` }
    });
    const usage = event || {} as LlmCallEvent;
    return {
      variantId: variant.id,
      model: variant.model,
      reasoningEffort: variant.reasoningEffort || null,
      output,
      durationMs: Math.round(usage.durationMs || 0),
      inputTokens: finiteToken(usage.inputTokens),
      cachedInputTokens: finiteToken(usage.cachedInputTokens),
      outputTokens: finiteToken(usage.outputTokens),
      reasoningTokens: finiteToken(usage.reasoningTokens),
      estimatedCostUsd: estimateCost(usage, variant),
      hardErrors: validateConversationEvalResult(testCase, output),
      callError: null
    };
  } catch (error) {
    const usage = event || {} as LlmCallEvent;
    return {
      variantId: variant.id,
      model: variant.model,
      reasoningEffort: variant.reasoningEffort || null,
      output: null,
      durationMs: Math.round(usage.durationMs || 0),
      inputTokens: finiteToken(usage.inputTokens),
      cachedInputTokens: finiteToken(usage.cachedInputTokens),
      outputTokens: finiteToken(usage.outputTokens),
      reasoningTokens: finiteToken(usage.reasoningTokens),
      estimatedCostUsd: estimateCost(usage, variant),
      hardErrors: ['model call failed'],
      callError: sanitizeError(error)
    };
  }
}

async function judgeCase(
  client: OpenAI,
  testCase: ConversationEvalCase,
  runs: VariantRun[],
  caseIndex: number
): Promise<{
  result: JudgeResult;
  labelToVariant: Record<BlindLabel, VariantId>;
  durationMs: number;
  estimatedCostUsd: number;
}> {
  const labels: BlindLabel[] = ['A', 'B', 'C'];
  const blindedVariants = rotate(variants, caseIndex + 1);
  const labelToVariant = Object.fromEntries(
    labels.map((label, index) => [label, blindedVariants[index].id])
  ) as Record<BlindLabel, VariantId>;
  const variantToLabel = Object.fromEntries(
    Object.entries(labelToVariant).map(([label, variantId]) => [variantId, label])
  ) as Record<VariantId, BlindLabel>;
  const outputByVariant = Object.fromEntries(runs.map((run) => [run.variantId, run.output]));
  const comparisonsRequested = [
    { left_label: variantToLabel.baseline, right_label: variantToLabel.luna_none },
    { left_label: variantToLabel.baseline, right_label: variantToLabel.luna_low }
  ];
  const judgeInput = {
    case: {
      id: testCase.id,
      bot_key: testCase.botKey,
      level: testCase.level,
      input_mode: testCase.inputMode,
      learner_message: testCase.text,
      expected_route: testCase.expectedRoute,
      expected_mistakes: testCase.expectedMistakes,
      pinned_topic: testCase.topic
    },
    anonymous_outputs: Object.fromEntries(
      labels.map((label) => [label, outputByVariant[labelToVariant[label]]])
    ),
    comparisons_requested: comparisonsRequested
  };

  const startedAt = performance.now();
  const response = await client.responses.create({
    model: judgeModel,
    reasoning: { effort: 'low' },
    input: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(judgeInput) }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'conversation_model_eval_judgment',
        strict: true,
        schema: JUDGE_SCHEMA
      }
    }
  } as never);
  const durationMs = Math.round(performance.now() - startedAt);
  const result = JSON.parse(parseResponseText(response)) as JudgeResult;
  const usage = response.usage as unknown as {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  };
  const estimatedCostUsd = estimateCost({
    inputTokens: usage?.input_tokens,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens,
    outputTokens: usage?.output_tokens
  }, judgeRates);
  return { result, labelToVariant, durationMs, estimatedCostUsd };
}

function buildAggregate(
  variant: ModelVariant,
  cases: Array<{
    runs: VariantRun[];
    judgment: JudgeResult;
    labelToVariant: Record<BlindLabel, VariantId>;
  }>
) {
  const runs = cases.map((item) => item.runs.find((run) => run.variantId === variant.id) as VariantRun);
  const assessments = cases.map((item) => {
    const label = Object.entries(item.labelToVariant)
      .find(([, variantId]) => variantId === variant.id)?.[0] as BlindLabel;
    return item.judgment.assessments.find((assessment) => assessment.label === label) as JudgeAssessment;
  });
  const pairwise = variant.id === 'baseline' ? [] : cases.map((item) => {
    const baselineLabel = Object.entries(item.labelToVariant)
      .find(([, variantId]) => variantId === 'baseline')?.[0] as BlindLabel;
    const candidateLabel = Object.entries(item.labelToVariant)
      .find(([, variantId]) => variantId === variant.id)?.[0] as BlindLabel;
    const comparison = item.judgment.comparisons.find((value) => (
      value.left_label === baselineLabel && value.right_label === candidateLabel
    ) || (
      value.left_label === candidateLabel && value.right_label === baselineLabel
    ));
    if (!comparison || comparison.winner === 'tie') return 'tie';
    return comparison.winner === candidateLabel ? 'win' : 'loss';
  });
  const qualityScores = assessments.map(qualityScore);
  const hardPasses = runs.filter((run) => run.hardErrors.length === 0 && !run.callError).length;
  return {
    variantId: variant.id,
    model: variant.model,
    reasoningEffort: variant.reasoningEffort || null,
    cases: runs.length,
    hardPassRate: rounded(hardPasses / runs.length),
    hardFailures: runs.length - hardPasses,
    criticalFailures: assessments.filter((assessment) => assessment.critical_failure).length,
    meanQuality: rounded(mean(qualityScores), 3),
    p50LatencyMs: Math.round(percentile(runs.map((run) => run.durationMs), 0.5)),
    p95LatencyMs: Math.round(percentile(runs.map((run) => run.durationMs), 0.95)),
    inputTokens: runs.reduce((sum, run) => sum + run.inputTokens, 0),
    cachedInputTokens: runs.reduce((sum, run) => sum + run.cachedInputTokens, 0),
    outputTokens: runs.reduce((sum, run) => sum + run.outputTokens, 0),
    reasoningTokens: runs.reduce((sum, run) => sum + run.reasoningTokens, 0),
    estimatedCostUsd: rounded(runs.reduce((sum, run) => sum + run.estimatedCostUsd, 0), 6),
    pairwiseWins: pairwise.filter((value) => value === 'win').length,
    pairwiseTies: pairwise.filter((value) => value === 'tie').length,
    pairwiseLosses: pairwise.filter((value) => value === 'loss').length
  };
}

function evaluateGates(aggregate: ReturnType<typeof buildAggregate>, baseline: ReturnType<typeof buildAggregate>) {
  const costReduction = baseline.estimatedCostUsd > 0
    ? 1 - aggregate.estimatedCostUsd / baseline.estimatedCostUsd
    : 0;
  const gates = {
    hardConstraints: aggregate.hardPassRate === 1,
    noCriticalRegressions: aggregate.criticalFailures === 0,
    qualityNotMateriallyBelow: aggregate.meanQuality >= baseline.meanQuality - 0.15,
    pairwiseNotMateriallyBelow: aggregate.pairwiseLosses <= aggregate.pairwiseWins + 2,
    p95LatencyWithin20Percent: aggregate.p95LatencyMs <= baseline.p95LatencyMs * 1.2,
    costReductionAtLeast40Percent: costReduction >= 0.4
  };
  return {
    ...gates,
    costReduction: rounded(costReduction, 4),
    passed: Object.values(gates).every(Boolean)
  };
}

function markdownReport(report: Record<string, unknown>): string {
  const aggregates = report.aggregates as Array<ReturnType<typeof buildAggregate>>;
  const gates = report.gates as Record<string, ReturnType<typeof evaluateGates>>;
  const selected = String(report.selectedVariant || 'none');
  const lines = [
    '# Balanced Conversation Model Evaluation',
    '',
    `Run: ${report.runAt}`,
    `Fixture: conversation-balanced-v1 (${report.caseCount} cases)`,
    `Judge: ${judgeModel} with low reasoning`,
    '',
    '| Variant | Hard pass | Critical | Quality | p50 ms | p95 ms | Cost USD | Pairwise W/T/L |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  ];
  for (const item of aggregates) {
    lines.push(`| ${item.variantId} (${item.model}${item.reasoningEffort ? `, ${item.reasoningEffort}` : ''}) | ${(item.hardPassRate * 100).toFixed(0)}% | ${item.criticalFailures} | ${item.meanQuality.toFixed(3)} | ${item.p50LatencyMs} | ${item.p95LatencyMs} | ${item.estimatedCostUsd.toFixed(6)} | ${item.pairwiseWins}/${item.pairwiseTies}/${item.pairwiseLosses} |`);
  }
  lines.push('', '## Gates', '');
  for (const [variantId, value] of Object.entries(gates)) {
    lines.push(`- ${variantId}: **${value.passed ? 'PASS' : 'FAIL'}**, cost reduction ${(value.costReduction * 100).toFixed(1)}%`);
    for (const [gate, passed] of Object.entries(value)) {
      if (gate === 'passed' || gate === 'costReduction') continue;
      lines.push(`  - ${gate}: ${passed ? 'pass' : 'fail'}`);
    }
  }
  lines.push(
    '',
    '## Decision',
    '',
    selected === 'none'
      ? 'No candidate passed every rollout gate. Keep the production conversation model on gpt-5.4.'
      : `Selected **${selected}** for a production canary. This is not a global rollout approval; production telemetry must pass next.`,
    '',
    'Prices use OpenAI Standard short-context rates verified on 2026-07-12. Judge cost is reported separately in the JSON report.',
    ''
  );
  return lines.join('\n');
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ConversationEvalFixture;
  const fixtureErrors = validateConversationEvalFixture(fixture);
  if (fixtureErrors.length) throw new Error(`invalid_eval_fixture:\n${fixtureErrors.join('\n')}`);
  const botConfigs = loadBotConfigs() as Record<string, Record<string, unknown>>;
  const missingBotKeys = fixture.cases.map((item) => item.botKey).filter((key) => !botConfigs[key]);
  if (missingBotKeys.length) throw new Error(`missing_bot_configs:${missingBotKeys.join(',')}`);
  console.log(`Validated ${fixture.cases.length} cases across ${Object.keys(botConfigs).length} bot configs.`);
  if (dryRun) return;
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('missing_openai_api_key');

  const judgeClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const evaluatedCases = [];
  let judgeCostUsd = 0;
  let judgeDurationMs = 0;

  for (const [caseIndex, testCase] of fixture.cases.entries()) {
    const runs: VariantRun[] = [];
    for (const variant of rotate(variants, caseIndex)) {
      console.log(`[${caseIndex + 1}/${fixture.cases.length}] ${testCase.id}: ${variant.id}`);
      runs.push(await runVariant(variant, testCase, botConfigs));
    }
    console.log(`[${caseIndex + 1}/${fixture.cases.length}] ${testCase.id}: judge`);
    const judgment = await judgeCase(judgeClient, testCase, runs, caseIndex);
    judgeCostUsd += judgment.estimatedCostUsd;
    judgeDurationMs += judgment.durationMs;
    evaluatedCases.push({
      case: testCase,
      runs,
      judgment: judgment.result,
      labelToVariant: judgment.labelToVariant,
      judgeDurationMs: judgment.durationMs,
      judgeEstimatedCostUsd: rounded(judgment.estimatedCostUsd, 6)
    });
  }

  const aggregates = variants.map((variant) => buildAggregate(variant, evaluatedCases));
  const baseline = aggregates.find((item) => item.variantId === 'baseline') as ReturnType<typeof buildAggregate>;
  const gates = Object.fromEntries(
    aggregates
      .filter((item) => item.variantId !== 'baseline')
      .map((item) => [item.variantId, evaluateGates(item, baseline)])
  ) as Record<string, ReturnType<typeof evaluateGates>>;
  const selectedVariant = gates.luna_none?.passed
    ? 'luna_none'
    : gates.luna_low?.passed
      ? 'luna_low'
      : 'none';
  const report = {
    reportVersion: 1,
    runAt: new Date().toISOString(),
    fixtureVersion: fixture.version,
    fixturePath: path.relative(rootDir, fixturePath),
    caseCount: fixture.cases.length,
    pricesVerifiedAt: '2026-07-12',
    judge: {
      model: judgeModel,
      reasoningEffort: 'low',
      durationMs: judgeDurationMs,
      estimatedCostUsd: rounded(judgeCostUsd, 6)
    },
    aggregates,
    gates,
    selectedVariant,
    cases: evaluatedCases
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownPath, markdownReport(report));
  console.log(`Selected variant: ${selectedVariant}`);
  console.log(`Wrote ${path.relative(rootDir, reportMarkdownPath)}`);
  console.log(`Wrote ${path.relative(rootDir, reportJsonPath)}`);
}

main().catch((error) => {
  console.error(sanitizeError(error));
  process.exitCode = 1;
});
