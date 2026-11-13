import fs from 'node:fs';
import OpenAI, { toFile } from 'openai';
import { loadLlmPrompt, promptResourcePath } from '../../ai/prompts/index.js';
import { promptContext } from '../../ai/prompts/bot-prompts.js';
import {
  observeLlmCall,
  type LlmCallRecorder,
  type LlmTraceContext
} from '../../ai/llm-telemetry.js';
import { transcribeWithScribe } from './scribe-transcription.js';

function transcriptionPrompt(language: string): string {
  const normalizedLanguage = language.trim().toLowerCase().split('-')[0];
  const languageCode = /^[a-z]{2,3}$/.test(normalizedLanguage) ? normalizedLanguage : 'en';
  const localizedName = `transcription/${languageCode}`;
  const name = fs.existsSync(promptResourcePath(localizedName)) ? localizedName : 'transcription/en';
  const filename = promptResourcePath(name);

  let prompt: string;
  try {
    prompt = loadLlmPrompt(name).trim();
  } catch (error) {
    throw new Error(`bot_runtime_transcription_prompt_unreadable:${filename}`, { cause: error });
  }
  if (!prompt) throw new Error(`bot_runtime_transcription_prompt_empty:${filename}`);
  return prompt;
}

export function createBotSpeech({
  openai,
  elevenlabsApiKey = '',
  transcriptionModel = 'scribe_v2',
  ttsModel = 'tts-1-hd',
  recordLlmCall,
  getBotConfig,
  fetchImpl = fetch
}: {
  openai(): Pick<OpenAI, 'audio'>;
  elevenlabsApiKey?: string;
  transcriptionModel?: string;
  ttsModel?: string;
  recordLlmCall?: LlmCallRecorder;
  getBotConfig(botKey: string): Record<string, unknown> | null;
  fetchImpl?: typeof fetch;
}) {
  return {
    async transcribe(
      botKey: string,
      audio: Buffer,
      options: { baseLanguage?: boolean; trace?: LlmTraceContext } = {}
    ): Promise<string> {
      const context = promptContext(botKey, getBotConfig(botKey) || {});
      const language = options.baseLanguage
        ? context.base_language_code
        : context.target_language_code;
      const result = await observeLlmCall({
        trace: options.trace || { botKey },
        operation: options.baseLanguage ? 'feedback.transcribe' : 'conversation.transcribe',
        model: transcriptionModel,
        record: recordLlmCall,
        call: async () => transcriptionModel === 'scribe_v2'
          ? transcribeWithScribe({ apiKey: elevenlabsApiKey, audio, language, fetchImpl })
          : openai().audio.transcriptions.create({
              file: await toFile(audio, 'voice.ogg', { type: 'audio/ogg' }),
              model: transcriptionModel,
              language,
              response_format: 'json',
              prompt: transcriptionPrompt(language)
            })
      });
      return String(result.text || '').trim();
    },

    async speech(botKey: string, text: string, trace: LlmTraceContext = { botKey }): Promise<Buffer> {
      const config = getBotConfig(botKey) || {};
      const voice = String(config.bot_voice || 'marin').trim().toLowerCase();
      const result = await observeLlmCall({
        trace,
        operation: 'conversation.speech',
        model: ttsModel,
        record: recordLlmCall,
        call: () => openai().audio.speech.create({
          model: ttsModel,
          voice: voice as never,
          input: text,
          response_format: 'opus'
        })
      });
      return Buffer.from(await result.arrayBuffer());
    }
  };
}
