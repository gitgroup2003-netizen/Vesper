import { IsString, Length, Matches, MinLength } from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class OtpRequestDto {
  @Matches(E164, { message: 'phone must be E.164, e.g. +256700000000' })
  phone: string;
}

export class OtpVerifyDto {
  @Matches(E164) phone: string;
  @IsString() @Length(6, 6) code: string;
}

export class RefreshDto {
  @IsString() @MinLength(20) refreshToken: string;
}
