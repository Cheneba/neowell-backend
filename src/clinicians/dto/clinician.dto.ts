import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ClinicianDocumentType } from '../../generated/prisma/enums';

export class RegisterClinicianDto {
  @IsString()
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MaxLength(60)
  licenseNumber: string;

  /** e.g. ["NEONATOLOGY", "PAEDIATRICS"] */
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  specialties: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  currentFacility?: string;

  /** Fee per consultation in XAF (FCFA). */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  consultationFeeXaf: number;
}

export class UpdateClinicianDto {
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsOptional() @IsString() @MaxLength(200) currentFacility?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) consultationFeeXaf?: number;
}

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

export class ReviewClinicianDto {
  @IsIn(['VERIFIED', 'REJECTED', 'SUSPENDED'])
  decision: 'VERIFIED' | 'REJECTED' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
