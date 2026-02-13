import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Guard that requires an authenticated session with the 'admin' role.
 * Returns 403 if the user is not an admin (or not logged in).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.session as any;
    return session?.userId && session?.role === "admin";
  }
}
