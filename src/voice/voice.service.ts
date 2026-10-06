import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BabiesService } from '../babies/babies.service';
import { detectComplaints } from '../checks/question-bank';
import { AuthUser } from '../common/auth-user';
import { Env } from '../config/env';
import { FilesService } from '../files/files.service';
import { Role, VoiceNoteStatus } from '../generated/prisma/enums';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export const AUDIO_MIME = [
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
];
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;

/** Voice notes for caregivers who find typing hard (FR-VOICE). Transcription is self-hosted (docs/05 Q6). */
@Injectable()
export class VoiceService implements OnModuleInit {
  private readonly logger = new Logger(VoiceService.name);
  private readonly sttUrl?: string;
  private readonly sttModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly babies: BabiesService,
    private readonly storage: StorageService,
    private readonly files: FilesService,
    private readonly jobs: JobsService,
    config: ConfigService<Env, true>,
  ) {
    this.sttUrl = config.get('STT_URL', { infer: true })?.replace(/\/$/, '');
    this.sttModel = config.get('STT_MODEL', { infer: true });
  }

  onModuleInit() {
    this.jobs.register('voice.transcribe', (p) => this.transcribe(p.voiceNoteId as string));
  }

  async upload(caregiverId: string, babyId: string, file?: Express.Multer.File) {
    await this.babies.findOwned(caregiverId, babyId);
    if (!file) throw new BadRequestException('file is required');
    if (!AUDIO_MIME.includes(file.mimetype))
      throw new BadRequestException(`Allowed audio types: ${AUDIO_MIME.join(', ')}`);
    const key = await this.storage.put(
      `babies/${babyId}/voice`,
      file.originalname || 'note.m4a',
      file.buffer,
    );
    const note = await this.prisma.voiceNote.create({
      data: {
        ownerId: caregiverId,
        babyId,
        storageKey: key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      },
    });
    await this.jobs.enqueue('voice.transcribe', { voiceNoteId: note.id }, { maxAttempts: 3 });
    return { id: note.id, status: note.status };
  }

  async get(user: AuthUser, id: string) {
    const note = await this.prisma.voiceNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Voice note not found');
    const allowed =
      (user.role === Role.CAREGIVER && note.ownerId === user.id) ||
      (user.role === Role.CLINICIAN &&
        (await this.prisma.consultation.count({
          where: {
            babyId: note.babyId,
            clinician: { userId: user.id },
            status: { notIn: ['AWAITING_PAYMENT'] },
          },
        })) > 0);
    if (!allowed) throw new NotFoundException('Voice note not found');
    return {
      id: note.id,
      status: note.status,
      transcript: note.transcript,
      language: note.language,
      detectedComplaints: note.detectedComplaints,
      audioUrl: this.files.url(note.storageKey, note.mimeType),
      createdAt: note.createdAt,
    };
  }

  /** Q6: send the audio to the self-hosted OpenAI-compatible speech-to-text endpoint. */
  async transcribe(voiceNoteId: string) {
    const note = await this.prisma.voiceNote.findUnique({ where: { id: voiceNoteId } });
    if (!note || note.status !== VoiceNoteStatus.PENDING) return { skipped: true };
    if (!this.sttUrl) {
      await this.prisma.voiceNote.update({
        where: { id: note.id },
        data: { status: VoiceNoteStatus.SKIPPED },
      });
      return { status: 'SKIPPED' };
    }
    const audio = await this.storage.read(note.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: note.mimeType }),
      `note.${note.storageKey.split('.').pop()}`,
    );
    form.append('model', this.sttModel);
    form.append('response_format', 'verbose_json');
    const res = await fetch(`${this.sttUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      this.logger.warn(`Speech-to-text HTTP ${res.status} for voice note ${note.id}`);
      throw new Error(`Speech-to-text HTTP ${res.status}`);
    }
    const body = (await res.json()) as { text?: string; language?: string };
    const transcript = (body.text ?? '').trim();
    await this.prisma.voiceNote.update({
      where: { id: note.id },
      data: {
        status: VoiceNoteStatus.TRANSCRIBED,
        transcript,
        language: body.language ?? null,
        detectedComplaints: detectComplaints(transcript),
      },
    });
    return { status: 'TRANSCRIBED' };
  }
}
