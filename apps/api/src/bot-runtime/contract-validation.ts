import { normalizeBotKey } from '../shared/normalization.js';
import {
  PREPARED_UPDATE_CONTRACT_VERSION,
  ROUTES,
  type PreparedUpdate
} from './contracts.js';

type UnknownRecord = Record<string, unknown>;

const routeSet = new Set<string>(ROUTES);
const updateTypes = new Set(['widget_query', 'callback_query', 'message', 'unknown']);

export class PreparedUpdateContractError extends Error {
  constructor() {
    super('invalid_contract');
    this.name = 'PreparedUpdateContractError';
  }
}

function invalidContract(): never {
  throw new PreparedUpdateContractError();
}

function asRecord(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidContract();
  return value as UnknownRecord;
}

function isSafeIntegerOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function isStringOrNull(value: unknown, maxLength: number): boolean {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

export function parsePreparedUpdateContract(value: unknown): PreparedUpdate {
  const contract = asRecord(value);
  if (contract.contractVersion !== PREPARED_UPDATE_CONTRACT_VERSION) invalidContract();

  const botKey = normalizeBotKey(contract.botKey);
  if (!botKey || contract.botKey !== botKey) invalidContract();

  const updateId = contract.updateId;
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0) {
    invalidContract();
  }
  if (contract.decisionId !== `v${PREPARED_UPDATE_CONTRACT_VERSION}:${botKey}:${updateId}`) {
    invalidContract();
  }
  if (typeof contract.route !== 'string' || !routeSet.has(contract.route)) invalidContract();

  const input = asRecord(contract.input);
  if (input.updateId !== updateId || !updateTypes.has(String(input.updateType ?? ''))) invalidContract();
  if (!isSafeIntegerOrNull(input.chatId)) invalidContract();
  if (typeof input.chatType !== 'string' || input.chatType.length > 32) invalidContract();
  if (typeof input.isPrivate !== 'boolean' || typeof input.isGroup !== 'boolean') invalidContract();

  const sender = asRecord(input.sender);
  if (!isSafeIntegerOrNull(sender.id) || typeof sender.isBot !== 'boolean') invalidContract();
  for (const field of ['username', 'firstName', 'lastName', 'languageCode']) {
    if (!isStringOrNull(sender[field], 256)) invalidContract();
  }

  const message = asRecord(input.message);
  if (!isSafeIntegerOrNull(message.id)) invalidContract();
  if (typeof message.text !== 'string' || message.text.length > 20_000) invalidContract();
  if (
    typeof message.hasText !== 'boolean' ||
    typeof message.hasVoice !== 'boolean' ||
    typeof message.isPinnedServiceUpdate !== 'boolean'
  ) invalidContract();
  if (!isStringOrNull(message.voiceFileId, 512)) invalidContract();
  if (
    message.voiceDuration !== null &&
    (typeof message.voiceDuration !== 'number' || !Number.isFinite(message.voiceDuration))
  ) invalidContract();

  if (input.callbackQuery !== null) {
    const callback = asRecord(input.callbackQuery);
    if (typeof callback.id !== 'string' || callback.id.length > 512) invalidContract();
    if (typeof callback.data !== 'string' || callback.data.length > 4096) invalidContract();
    if (typeof callback.messageText !== 'string' || callback.messageText.length > 4096) {
      invalidContract();
    }
    if (!isSafeIntegerOrNull(callback.userId) || !isSafeIntegerOrNull(callback.messageId)) {
      invalidContract();
    }
  }

  const routingFacts = asRecord(contract.routingFacts);
  if (typeof routingFacts.pendingFeedback !== 'boolean') invalidContract();
  const context = asRecord(contract.context);
  asRecord(context.keyboard);

  return contract as unknown as PreparedUpdate;
}
