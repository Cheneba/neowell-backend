import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Locale } from '../../generated/prisma/enums';

const NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(NAME, { message: 'firstName may only contain letters, spaces, apostrophes and hyphens' })
  firstName?: string;

  /** Used for the hospital naming convention "Baby {lastName}" (FR-BABY-02). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(NAME, { message: 'lastName may only contain letters, spaces, apostrophes and hyphens' })
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @IsOptional() @IsString() @MaxLength(60) region?: string;
  @IsOptional() @IsString() @MaxLength(60) city?: string;
}

/** Each flag grants (true) or withdraws (false) one consent. Omitted flags are unchanged. */
export class UpdateConsentsDto {
  /** Storing the baby's health checks. Required to record checks. */
  @IsOptional()
  @IsBoolean()
  dataCollection?: boolean;

  /** Sharing data with the clinicians the caregiver books. Required to book. */
  @IsOptional()
  @IsBoolean()
  clinicianShare?: boolean;

  /** Recording teleconsultations. */
  @IsOptional()
  @IsBoolean()
  recording?: boolean;
}
