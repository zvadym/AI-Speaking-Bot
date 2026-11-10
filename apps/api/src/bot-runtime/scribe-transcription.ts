export async function transcribeWithScribe({
  apiKey,
  audio,
  language,
  fetchImpl = fetch,
  timeoutMs = 120_000
}: {
  apiKey: string;
  audio: Buffer;
  language: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ text: string }> {
  if (!apiKey.trim()) {
    throw Object.assign(new Error('missing_elevenlabs_api_key'), { code: 'missing_elevenlabs_api_key' });
  }
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'voice.ogg');
  form.set('model_id', 'scribe_v2');
  form.set('language_code', language);
  form.set('no_verbatim', 'false');
  form.set('tag_audio_events', 'true');
  form.set('diarize', 'false');
  form.set('timestamps_granularity', 'word');

  const response = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    // Provider bodies may contain user data; expose only a bounded status code.
    await response.body?.cancel();
    const code = `elevenlabs_stt_http_${response.status}`;
    throw Object.assign(new Error(code), { code, status: response.status });
  }
  const invalidResponse = () => Object.assign(new Error('elevenlabs_stt_invalid_response'), {
    code: 'elevenlabs_stt_invalid_response'
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw error;
    throw invalidResponse();
  }
  if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') {
    throw invalidResponse();
  }
  // Keep the raw transcript, including fillers, repetitions and audio-event tags.
  return { text: result.text };
}
