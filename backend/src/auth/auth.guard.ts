import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

export interface AuthUser { id: string }

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'unauthorized' });
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7), { algorithms: ['HS256'] });
      req.user = { id: payload.sub } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException({ code: 'token_invalid_or_expired' });
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
