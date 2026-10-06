import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ConsultationMedium,
  ConsultationTiming,
  ReferralUrgency,
} from '../../generated/prisma/enums';

export class BookConsultationDto {
  @IsUUID() babyId: string;
  @IsUUID() clinicianId: string;
  @IsEnum(ConsultationMedium) medium: ConsultationMedium;
  @IsEnum(ConsultationTiming) timing: ConsultationTiming;

  /** Slot start (SCHEDULED only). Must fall inside the clinician's availability. */
  @IsOptional() @IsDateString() scheduledAt?: string;

  @IsOptional() @IsString() @MaxLength(1000) reason?: string;

  /** The check that led to this booking. */
  @IsOptional() @IsUUID() observationId?: string;

  /** Fever steps already tried, e.g. { removedClothes: true, cooledRoom: true, sponged: false, rechecked: true } (FR-CONS-05). */
  @IsOptional() @IsObject() preConsultChecklist?: Record<string, boolean>;

  @IsOptional() @IsBoolean() recordingConsent?: boolean;
}

export class PayDto {
  @IsIn(['MTN_MOMO', 'ORANGE_MONEY', 'SANDBOX'])
  provider: 'MTN_MOMO' | 'ORANGE_MONEY' | 'SANDBOX';

  /** Mobile money number that approves the payment. */
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'payerPhone must be in E.164 format' })
  payerPhone: string;
}

export class ListConsultationsQuery {
  @IsOptional() @IsIn(['active', 'past']) scope?: 'active' | 'past';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ReasonDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class CompleteDto {
  @IsOptional() @IsString() @MaxLength(5000) clinicianNotes?: string;
  @IsOptional() @IsString() @MaxLength(1000) diagnosisSummary?: string;
}

export class SummaryQuery {
  @IsOptional() @IsIn(['3', '7']) days?: '3' | '7';
}

export class SendMessageDto {
  @IsString() @MaxLength(2000) body: string;
}

export class MessagesQuery {
  @IsOptional() @IsUUID() after?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ReadDto {
  @IsUUID() upToId: string;
}

export class ReferralDto {
  @IsOptional() @IsUUID() facilityId?: string;
  @IsOptional() @IsString() @MaxLength(200) facilityName?: string;
  @IsEnum(ReferralUrgency) urgency: ReferralUrgency;
  @IsString() @MaxLength(1000) reason: string;
}

export class DrugChartItemDto {
  @IsString() @MaxLength(120) drugName: string;
  @IsString() @MaxLength(60) dose: string;
  @IsString() @MaxLength(60) route: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  timesOfDay: string[];
  @IsInt() @Min(1) @Max(90) durationDays: number;
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
}

export class DrugChartDto {
  @IsOptional() @IsDateString() startDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DrugChartItemDto)
  items: DrugChartItemDto[];
}

export class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
