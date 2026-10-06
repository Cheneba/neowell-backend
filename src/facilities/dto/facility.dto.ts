import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt } from 'class-validator';
import { FacilityService } from '../../generated/prisma/enums';

const PHONE = /^\+?[0-9 ]{6,20}$/;

export class NearbyFacilitiesQuery {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lon: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm?: number;

  /** Only facilities offering this service. */
  @IsOptional()
  @IsEnum(FacilityService)
  service?: FacilityService;
}

export class DepartmentDto {
  @IsEnum(FacilityService)
  service: FacilityService;

  @IsString()
  @MaxLength(120)
  name: string;

  @Matches(PHONE)
  phone: string;
}

export class CreateFacilityDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional() @IsString() @MaxLength(100) region?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(FacilityService, { each: true })
  services: FacilityService[];

  @IsOptional()
  @Matches(PHONE)
  mainPhone?: string;

  @IsOptional() @IsString() @MaxLength(200) hours?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DepartmentDto)
  departments?: DepartmentDto[];
}

export class UpdateFacilityDto extends PartialType(CreateFacilityDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SearchFacilitiesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
