import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import {
  ActivityLevel,
  BreathingStatus,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  SkinColor,
  StoolPattern,
  TemperatureSource,
} from '../../generated/prisma/enums';

export class CreateObservationDto {
  /** When the check was done. Defaults to now; set it when syncing checks queued offline. */
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  /** Axillary temperature in °C. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(43)
  temperatureC?: number;

  @IsOptional()
  @IsEnum(TemperatureSource)
  temperatureSrc?: TemperatureSource;

  /** Number of feeds in the last 24 hours. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  feedingCount24h?: number;

  @IsOptional() @IsEnum(FeedingQuality) feedingQuality?: FeedingQuality;
  @IsOptional() @IsEnum(StoolPattern) stoolPattern?: StoolPattern;
  @IsOptional() @IsEnum(SkinColor) skinColor?: SkinColor;
  @IsOptional() @IsEnum(CryDescription) cry?: CryDescription;
  @IsOptional() @IsEnum(ActivityLevel) activity?: ActivityLevel;
  @IsOptional() @IsEnum(BreathingStatus) breathing?: BreathingStatus;
  @IsOptional() @IsEnum(JaundiceLevel) jaundice?: JaundiceLevel;
  @IsOptional() @IsEnum(CordStatus) cordStatus?: CordStatus;

  @IsOptional()
  @IsBoolean()
  convulsions?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListObservationsQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
