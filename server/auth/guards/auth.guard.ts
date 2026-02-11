import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Guard that requires an authenticated session.
 * Returns 401 JSON if the user is not logged in.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // express-session augments req.session with our custom fields
    const session = request.session as any;
    if (!session?.userId) {
      return false;
    }
    return true;
  }
}
