import { PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CareStatus, Sex } from '../../generated/prisma/enums';

/** FR-BABY-01: birth measurements are required (meeting decision). */
export class CreateBabyDto {
  @IsEnum(Sex)
  sex: Sex;

  /** ISO 8601 date-time of birth. */
  @IsDateString()
  dateOfBirth: string;

  /** Weeks of pregnancy at birth (37–41 = term, < 37 = preterm). */
  @IsInt()
  @Min(22)
  @Max(44)
  gestationalAgeWeeks: number;

  @IsInt()
  @Min(300)
  @Max(7000)
  birthWeightGrams: number;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(25)
  @Max(65)
  birthLengthCm: number;

  /** "HC" in the hospital booklet. */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(18)
  @Max(45)
  birthHeadCircumferenceCm: number;

  /** Optional — babies are called "Baby {mother's last name}" until 42 days. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  givenName?: string;

  @IsOptional()
  @IsUUID()
  birthFacilityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  birthFacilityName?: string;

  @IsOptional()
  @IsEnum(CareStatus)
  careStatus?: CareStatus;

  @IsOptional()
  @IsDateString()
  dischargeDate?: string;
}

export class UpdateBabyDto extends PartialType(CreateBabyDto) {}
