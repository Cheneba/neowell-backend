import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ActivityLevel,
  BreathingSound,
  BreathingStatus,
  CheckType,
  ClothingLevel,
  Complaint,
  CordStatus,
  CryDescription,
  FeedingQuality,
  JaundiceLevel,
  RoomFeel,
  SkinColor,
  StoolPattern,
  TemperatureSource,
  VomitingStatus,
} from '../../generated/prisma/enums';

export class CheckPlanQuery {
  @IsEnum(CheckType)
  type: CheckType = CheckType.ROUTINE;

  /** Comma-separated complaints for UNWELL checks, e.g. FEVER,VOMITING. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsEnum(Complaint, { each: true })
  complaints?: Complaint[];

  @IsOptional()
  @IsIn(['en', 'fr'])
  lang?: 'en' | 'fr';
}

export class CreateObservationDto {
  @IsOptional()
  @IsEnum(CheckType)
  checkType?: CheckType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(13)
  @IsEnum(Complaint, { each: true })
  complaints?: Complaint[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  complaintText?: string;

  /** Client-generated id; re-sending the same value returns the stored check (FR-CHK-11). */
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  clientRef?: string;

  /** Set when this check answers a pending recheck (FR-CHK-08). */
  @IsOptional()
  @IsUUID()
  recheckOfId?: string;

  @IsOptional()
  @IsUUID()
  voiceNoteId?: string;

  /** When the check was done. Defaults to now; set it when syncing checks queued offline. */
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  /** Axillary temperature in °C — required (FR-CHK-02). */
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(30)
  @Max(43)
  temperatureC: number;

  @IsOptional() @IsEnum(TemperatureSource) temperatureSrc?: TemperatureSource;
  @IsOptional() @IsInt() @Min(0) @Max(30) feedingCount24h?: number;
  @IsOptional() @IsEnum(FeedingQuality) feedingQuality?: FeedingQuality;
  @IsOptional() @IsEnum(StoolPattern) stoolPattern?: StoolPattern;
  @IsOptional() @IsEnum(SkinColor) skinColor?: SkinColor;
  @IsOptional() @IsEnum(CryDescription) cry?: CryDescription;
  @IsOptional() @IsEnum(ActivityLevel) activity?: ActivityLevel;
  @IsOptional() @IsEnum(BreathingStatus) breathing?: BreathingStatus;
  /** Breaths per minute from the 60-second counter. */
  @IsOptional() @IsInt() @Min(5) @Max(150) respiratoryRate?: number;
  @IsOptional() @IsBoolean() chestIndrawing?: boolean;
  @IsOptional() @IsEnum(BreathingSound) breathingSound?: BreathingSound;
  @IsOptional() @IsEnum(JaundiceLevel) jaundice?: JaundiceLevel;
  @IsOptional() @IsEnum(CordStatus) cordStatus?: CordStatus;
  @IsOptional() @IsEnum(VomitingStatus) vomiting?: VomitingStatus;
  @IsOptional() @IsEnum(RoomFeel) roomFeel?: RoomFeel;
  @IsOptional() @IsEnum(ClothingLevel) clothing?: ClothingLevel;
  @IsOptional() @IsBoolean() convulsions?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ListObservationsQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsDateString() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class RechecksQuery {
  @IsOptional() @IsIn(['PENDING', 'DONE', 'MISSED']) status?: 'PENDING' | 'DONE' | 'MISSED';
}
