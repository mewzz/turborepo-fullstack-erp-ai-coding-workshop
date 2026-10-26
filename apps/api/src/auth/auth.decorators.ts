import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role, User } from '@erp/contracts';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const STORE_SCOPE_KEY = 'auth:storeScope';

/** Every route requires a signed-in user unless it (or its controller) is marked `@Public()`. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Only users with one of these roles may call the route, e.g. `@Roles('ADMINISTRATOR')`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Restrict a route to the caller's own store. `key` names where the target store id lives on the
 * request (a route param or a body field, e.g. `@StoreScoped('storeId')`). A `STORE_EMPLOYEE` may
 * only act on their assigned store; roles without a store assignment (e.g. `MANAGER`,
 * `ADMINISTRATOR`, `PURCHASING_OFFICER`) are not store-scoped and pass.
 */
export const StoreScoped = (key: string) => SetMetadata(STORE_SCOPE_KEY, key);

/** The request after `AuthGuard` has run. `user` is unset on public routes without a session. */
export type AuthenticatedRequest = Request & { user?: User };

/** The signed-in user, set by `AuthGuard`. Use as a parameter decorator next to `@Implement(...)`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
