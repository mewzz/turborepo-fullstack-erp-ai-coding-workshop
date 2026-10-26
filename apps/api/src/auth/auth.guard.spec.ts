import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { User } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../database/prisma.service.js';
import { type AuthenticatedRequest, Public, Roles, StoreScoped } from './auth.decorators.js';
import { AuthGuard } from './auth.guard.js';
import { createSessionToken, SESSION_COOKIE } from './session-token.js';

const secret = 'test-secret-that-is-at-least-32-characters';
const staff: User = {
  id: 'u1',
  email: 'staff@erp.local',
  name: 'Staff User',
  role: 'STORE_EMPLOYEE',
  storeId: 'store-a',
};

class RoutesUnderTest {
  @Public()
  open() {}

  closed() {}

  @Roles('ADMINISTRATOR')
  adminOnly() {}

  @Roles('MANAGER', 'ADMINISTRATOR')
  managerOrAdmin() {}

  @StoreScoped('storeId')
  storeScoped() {}
}

function setup(user: User | null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const guard = new AuthGuard(
    new Reflector(),
    { user: { findUnique } } as unknown as PrismaService,
    { get: () => secret } as unknown as ConfigService<Env, true>,
  );

  function run(route: keyof RoutesUnderTest, cookie?: string, params?: Record<string, unknown>) {
    const request = {
      headers: { cookie },
      params: params ?? {},
      body: params ?? {},
    } as unknown as AuthenticatedRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => RoutesUnderTest.prototype[route],
      getClass: () => RoutesUnderTest,
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  }

  return { run, findUnique };
}

const sessionCookie = (userId: string) => `${SESSION_COOKIE}=${createSessionToken(userId, secret)}`;

describe('AuthGuard', () => {
  it('lets anyone call a @Public() route', async () => {
    const { run } = setup(null);

    await expect(run('open').result).resolves.toBe(true);
  });

  it('rejects a protected route without a session', async () => {
    const { run } = setup(staff);

    await expect(run('closed').result).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a tampered cookie', async () => {
    const { run, findUnique } = setup(staff);

    await expect(
      run('closed', `${SESSION_COOKIE}=u1.9999999999999.forged`).result,
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects a session whose user no longer exists', async () => {
    const { run } = setup(null);

    await expect(run('closed', sessionCookie('gone')).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the signed-in user to the request', async () => {
    const { run } = setup(staff);
    const { request, result } = run('closed', sessionCookie('u1'));

    await expect(result).resolves.toBe(true);
    expect(request.user).toEqual(staff);
  });

  it('rejects a user without the required role', async () => {
    const { run } = setup(staff);

    await expect(run('adminOnly', sessionCookie('u1')).result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows a user with the required role', async () => {
    const { run } = setup({ ...staff, role: 'ADMINISTRATOR' });

    await expect(run('adminOnly', sessionCookie('u1')).result).resolves.toBe(true);
  });

  it('allows any user whose role is in the @Roles() list', async () => {
    const { run } = setup({ ...staff, role: 'MANAGER' });

    await expect(run('managerOrAdmin', sessionCookie('u1')).result).resolves.toBe(true);
  });

  describe('store scoping', () => {
    it('lets a store employee act within their assigned store', async () => {
      const { run } = setup(staff);

      await expect(
        run('storeScoped', sessionCookie('u1'), { storeId: 'store-a' }).result,
      ).resolves.toBe(true);
    });

    it('forbids a store employee acting outside their assigned store', async () => {
      const { run } = setup(staff);

      await expect(
        run('storeScoped', sessionCookie('u1'), { storeId: 'store-b' }).result,
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a store employee with no store assignment', async () => {
      const { run } = setup({ ...staff, storeId: null });

      await expect(
        run('storeScoped', sessionCookie('u1'), { storeId: 'store-a' }).result,
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a non-store-scoped role act on any store', async () => {
      const { run } = setup({ ...staff, role: 'MANAGER', storeId: null });

      await expect(
        run('storeScoped', sessionCookie('u1'), { storeId: 'store-b' }).result,
      ).resolves.toBe(true);
    });
  });
});
