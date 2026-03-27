import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // Try to extract user from token if present
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data, error } =
        await this.supabaseService.getClient().auth.getUser(token);

      if (!error && data.user) {
        request.user = {
          id: data.user.id,
          email: data.user.email,
        };
      } else if (!isPublic) {
        throw new UnauthorizedException('Invalid or expired token');
      }
    } else if (!isPublic) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    return true;
  }
}
