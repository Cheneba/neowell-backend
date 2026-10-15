import { SpeechToText, Transcription } from './speech-to-text';

/** Any server exposing POST {url}/v1/audio/transcriptions (Whisper, faster-whisper, OpenAI…). */
export class OpenAiSpeechToText extends SpeechToText {
  readonly enabled = true;

  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string): Promise<Transcription> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    const res = await this.fetchImpl(`${this.url}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      body: form,
    });
    if (!res.ok) throw new Error(`Speech-to-text HTTP ${res.status}`);
    const body = (await res.json()) as { text?: string; language?: string };
    return { text: (body.text ?? '').trim(), language: body.language };
  }
}
