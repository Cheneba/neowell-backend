import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClinicianDocumentType, ConsultationMedium } from '../../generated/prisma/enums';

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

export class RegisterClinicianDto {
  @IsString() @MinLength(1) @MaxLength(60) @Matches(NAME) firstName: string;
  @IsString() @MinLength(1) @MaxLength(60) @Matches(NAME) lastName: string;

  /** e.g. Dr, Pr */
  @IsOptional() @IsString() @MaxLength(10) title?: string;

  @IsString() @MaxLength(60) licenseNumber: string;

  /** e.g. ["NEONATOLOGY", "PAEDIATRICS"] */
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties: string[];

  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsOptional() @IsString() @MaxLength(200) currentFacility?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) yearsExperience?: number;

  @IsOptional() @IsBoolean() offersChat?: boolean;
  @IsOptional() @IsBoolean() offersAudio?: boolean;
  @IsOptional() @IsBoolean() offersVideo?: boolean;

  /** Fees in XAF (FCFA). Chat < audio < video is recommended (FR-CLIN-01). */
  @IsInt() @Min(0) @Max(1_000_000) feeChatXaf: number;
  @IsInt() @Min(0) @Max(1_000_000) feeAudioXaf: number;
  @IsInt() @Min(0) @Max(1_000_000) feeVideoXaf: number;

  /** Mobile money account for payouts — visible to admins only (FR-CLIN-07). */
  @IsOptional() @IsIn(['MTN_MOMO', 'ORANGE_MONEY']) payoutProvider?: 'MTN_MOMO' | 'ORANGE_MONEY';
  @IsOptional() @Matches(/^\+[1-9]\d{7,14}$/) payoutPhone?: string;
}

export class UpdateClinicianDto extends PartialType(RegisterClinicianDto) {}

export class UploadDocumentDto {
  @IsEnum(ClinicianDocumentType)
  type: ClinicianDocumentType;
}

export class AvailabilitySlotDto {
  /** 0 = Sunday … 6 = Saturday */
  @IsInt() @Min(0) @Max(6) dayOfWeek: number;
  /** Minutes from midnight, local time. */
  @IsInt() @Min(0) @Max(1439) startMinute: number;
  @IsInt() @Min(1) @Max(1440) endMinute: number;
}

export class SetAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
}

export class AvailableNowDto {
  /** 0 switches it off. */
  @IsInt() @Min(0) @Max(240) minutes: number;
}

export class ListCliniciansQuery {
  @IsOptional() @IsEnum(ConsultationMedium) medium?: ConsultationMedium;
  @IsOptional() @IsIn(['true', 'false']) availableNow?: 'true' | 'false';
}

export class SlotsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14) days?: number;
}

export class ReviewClinicianDto {
  @IsIn(['VERIFIED', 'REJECTED', 'SUSPENDED'])
  decision: 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
