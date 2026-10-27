import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { AuditController } from './audit.controller.js';

const createdAt = new Date('2026-01-02T03:04:05.000Z');

function auditRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1',
    actorId: 'u-mgr',
    action: 'STOCK_ADJUSTMENT',
    sourceDocument: 'ADJ-1700000000000: นับสต็อกใหม่',
    outcome: 'SUCCESS' as const,
    createdAt,
    actor: { name: 'Manager One' },
    ...over,
  };
}

async function createController(findMany: ReturnType<typeof vi.fn>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuditController],
    providers: [{ provide: PrismaService, useValue: { auditLog: { findMany } } }],
  }).compile();
  return moduleRef.get(AuditController);
}

describe('AuditController.list', () => {
  it('returns entries with the actor name joined in and the timestamp as ISO', async () => {
    const findMany = vi.fn().mockResolvedValue([auditRow()]);
    const controller = await createController(findMany);

    await expect(call(controller.list(), undefined)).resolves.toEqual([
      {
        id: 'a1',
        actorId: 'u-mgr',
        actorName: 'Manager One',
        action: 'STOCK_ADJUSTMENT',
        sourceDocument: 'ADJ-1700000000000: นับสต็อกใหม่',
        outcome: 'SUCCESS',
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  it('returns failures as well as successes, most recent first', async () => {
    const findMany = vi.fn().mockResolvedValue([auditRow({ id: 'a2', outcome: 'FAILURE' })]);
    const controller = await createController(findMany);

    const entries = await call(controller.list(), undefined);
    expect(entries[0]?.outcome).toBe('FAILURE');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });
});
