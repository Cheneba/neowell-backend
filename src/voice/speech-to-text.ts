export interface Transcription {
  text: string;
  language?: string;
}

/**
 * Speech-to-text port. Drivers: OpenAI-compatible endpoint (self-hosted or hosted) and a
 * disabled no-op that marks voice notes SKIPPED.
 */
export abstract class SpeechToText {
  abstract readonly enabled: boolean;
  /** Throws on failure so the job retries. */
  abstract transcribe(audio: Buffer, mimeType: string, filename: string): Promise<Transcription>;
}

export class DisabledSpeechToText extends SpeechToText {
  readonly enabled = false;
  async transcribe(): Promise<Transcription> {
    throw new Error('Speech-to-text is not configured');
  }
}
