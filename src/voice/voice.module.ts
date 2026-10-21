import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env';
import { BabiesModule } from '../babies/babies.module';
import { DisabledSpeechToText, SpeechToText } from './speech-to-text';
import { OpenAiSpeechToText } from './speech-to-text.openai';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

@Module({
  imports: [BabiesModule],
  controllers: [VoiceController],
  providers: [
    {
      provide: SpeechToText,
      inject: [ConfigService],
      useFactory: (c: ConfigService<Env, true>): SpeechToText => {
        const url = c.get('STT_URL', { infer: true })?.replace(/\/$/, '');
        return url
          ? new OpenAiSpeechToText(url, c.get('STT_MODEL', { infer: true }))
          : new DisabledSpeechToText();
      },
    },
    VoiceService,
  ],
  exports: [SpeechToText],
})
export class VoiceModule {}
