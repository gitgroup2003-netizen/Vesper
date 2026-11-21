import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { OtpRequestDto, OtpVerifyDto, RefreshDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  @HttpCode(204)
  async requestOtp(@Body() dto: OtpRequestDto, @Req() req: FastifyRequest): Promise<void> {
    await this.auth.requestOtp(dto.phone, req.ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: OtpVerifyDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}
