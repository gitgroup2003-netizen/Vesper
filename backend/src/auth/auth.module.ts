import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './auth.guard';
import { ConsoleSmsSender, SMS_SENDER } from './sms';
import { config } from '../config';

@Module({
  imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { algorithm: 'HS256' } })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, { provide: SMS_SENDER, useClass: ConsoleSmsSender }],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
