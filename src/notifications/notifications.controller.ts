import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class RegisterDeviceDto {
  /** FCM registration token (or an Expo token, depending on PUSH_DRIVER). */
  @IsOptional() @IsString() @Length(20, 4096) pushToken?: string;

  /** Older app builds send this name. */
  @IsOptional() @IsString() @Length(20, 4096) expoPushToken?: string;

  @IsIn(['android', 'ios', 'web'])
  platform: string;
}

class InboxQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() cursor?: string;
}

class MarkReadDto {
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) ids?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Register this phone for push notifications (FR-ACC-05). */
  @Post('devices')
  registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    const token = dto.pushToken ?? dto.expoPushToken;
    if (!token) throw new BadRequestException('pushToken is required');
    return this.notifications.registerDevice(user.id, token, dto.platform);
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.notifications.removeDevice(user.id, token);
  }

  /** Notification inbox, newest first (FR-ACC-06). */
  @Get('notifications')
  inbox(@CurrentUser() user: AuthUser, @Query() q: InboxQuery) {
    return this.notifications.inbox(user.id, q.limit, q.cursor);
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.id, dto.ids, dto.all);
  }
}
