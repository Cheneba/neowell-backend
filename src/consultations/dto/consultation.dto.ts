import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ConsultationStatus, ConsultationType } from '../../generated/prisma/enums';

export class BookConsultationDto {
  @IsUUID()
  babyId: string;

  @IsUUID()
  clinicianId: string;

  @IsEnum(ConsultationType)
  type: ConsultationType;

  /** Slot start (ISO 8601). Must fall inside the clinician's availability. */
  @IsDateString()
  scheduledAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  /** Caregiver agrees to this consultation being recorded. */
  @IsOptional()
  @IsBoolean()
  recordingConsent?: boolean;
}

export class UpdateConsultationStatusDto {
  @IsIn([
    ConsultationStatus.CONFIRMED,
    ConsultationStatus.IN_PROGRESS,
    ConsultationStatus.COMPLETED,
    ConsultationStatus.CANCELLED,
    ConsultationStatus.NO_SHOW,
  ])
  status: ConsultationStatus;

  /** Clinician's notes, typically added when completing. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  clinicianNotes?: string;
}
