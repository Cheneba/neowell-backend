import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Locale } from '../../generated/prisma/enums';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}

/** Each flag grants (true) or withdraws (false) one consent. Omitted flags are unchanged. */
export class UpdateConsentsDto {
  /** Collecting and storing the baby's health observations. */
  @IsOptional()
  @IsBoolean()
  dataCollection?: boolean;

  /** Sharing observations and summaries with clinicians the caregiver books. */
  @IsOptional()
  @IsBoolean()
  clinicianShare?: boolean;

  /** Recording teleconsultations. */
  @IsOptional()
  @IsBoolean()
  recording?: boolean;
}
