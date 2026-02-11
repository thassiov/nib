import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";

/**
 * Guard that allows both authenticated and anonymous access.
 * Session data is available if the user is logged in, but the request is never blocked.
 * This is a documentation/intent marker in route definitions.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
