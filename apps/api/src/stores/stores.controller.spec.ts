import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { StoresController } from './stores.controller.js';

const store = { id: 'st1', code: 'B01', name: 'Central' };

describe('StoresController', () => {
  it('lists stores ordered by code', async () => {
    const findMany = vi.fn().mockResolvedValue([store]);
    const moduleRef = await Test.createTestingModule({
      controllers: [StoresController],
      providers: [{ provide: PrismaService, useValue: { store: { findMany } } }],
    }).compile();
    const controller = moduleRef.get(StoresController);

    await expect(call(controller.list(), undefined)).resolves.toEqual([store]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { code: 'asc' } }),
    );
  });
});
