import { PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Sex } from '../../generated/prisma/enums';

export class CreateBabyDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsEnum(Sex)
  sex?: Sex;

  /** ISO 8601 date-time of birth. */
  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(7000)
  birthWeightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(22)
  @Max(44)
  gestationalAgeWeeks?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  birthHospital?: string;

  @IsOptional()
  @IsDateString()
  dischargeDate?: string;
}

export class UpdateBabyDto extends PartialType(CreateBabyDto) {}
