import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../common/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../generated/prisma/enums';
import { AuthService } from './auth.service';
import {
  RefreshDto,
  RequestOtpDto,
  TokenPairDto,
  VerifyOtpDto,
  WebCredentialsDto,
  WebLoginDto,
  WebRegisterDto,
  WebResetPasswordDto,
  WebRequestOtpDto,
  WebVerifyOtpDto,
} from './dto/auth.dto';
import { OtpService } from './otp.service';

@ApiTags('auth')
// Tight limit against OTP/password guessing; relaxed under test so suites can sign in many users.
@Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 1000 : 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
  ) {}

  /** Send a 6-digit sign-in code by SMS. Works for both sign-up and sign-in. */
  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.otp.request(dto.phone);
  }

  /** Exchange a valid code for tokens. Creates the account on first sign-in. */
  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body() dto: VerifyOtpDto): Promise<TokenPairDto> {
    return this.auth.verifyOtp(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<TokenPairDto> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  // ── Web dashboard (clinicians and admins only). Mobile keeps using the OTP routes above. ──

  /** Same SMS code as the app. Use it for sign-up, OTP sign-in and password reset. */
  @Public()
  @Post('web/otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  webRequestOtp(@Body() dto: WebRequestOtpDto) {
    return this.auth.webRequestOtp(dto);
  }

  /** Phone + OTP sign-in for an existing clinician or admin. */
  @Public()
  @Post('web/otp/verify')
  @HttpCode(HttpStatus.OK)
  webVerifyOtp(@Body() dto: WebVerifyOtpDto): Promise<TokenPairDto> {
    return this.auth.webVerifyOtp(dto);
  }

  /** Email + password sign-in for an existing clinician or admin. */
  @Public()
  @Post('web/login')
  @HttpCode(HttpStatus.OK)
  webLogin(@Body() dto: WebLoginDto): Promise<TokenPairDto> {
    return this.auth.webLogin(dto);
  }

  /** Creates a clinician account (phone proven by OTP). Admins are never created here. */
  @Public()
  @Post('web/register')
  webRegister(@Body() dto: WebRegisterDto): Promise<TokenPairDto> {
    return this.auth.webRegister(dto);
  }

  @Public()
  @Post('web/password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async webResetPassword(@Body() dto: WebResetPasswordDto): Promise<void> {
    await this.auth.webResetPassword(dto);
  }

  /** Set or change the password (and email) of the signed-in clinician or admin. */
  @Put('web/credentials')
  @ApiBearerAuth()
  @Roles(Role.CLINICIAN, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setCredentials(
    @CurrentUser() user: AuthUser,
    @Body() dto: WebCredentialsDto,
  ): Promise<void> {
    await this.auth.setCredentials(user.id, dto);
  }
}
