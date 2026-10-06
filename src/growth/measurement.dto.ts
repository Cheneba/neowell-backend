import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MeasurementSource } from '../generated/prisma/enums';

export class CreateMeasurementDto {
  @IsDateString()
  measuredAt: string;

  @IsOptional() @IsInt() @Min(300) @Max(30000) weightGrams?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(25) @Max(130) lengthCm?: number;
  /** "HC" — head circumference. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 1 }) @Min(18) @Max(60) headCircumferenceCm?: number;

  @IsEnum(MeasurementSource)
  source: MeasurementSource;

  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
