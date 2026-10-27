import { Controller } from '@nestjs/common';
import { contract } from '@erp/contracts';
import { Implement, implement, ORPCError } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { isRecordNotFound, isUniqueViolation } from '../database/prisma-errors.js';
import { PrismaService } from '../database/prisma.service.js';

@Controller()
export class SuppliersController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.suppliers.list)
  list() {
    return implement(contract.suppliers.list).handler(() =>
      this.prisma.supplier.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  @Implement(contract.suppliers.get)
  get() {
    return implement(contract.suppliers.get).handler(async ({ input }) => {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: input.id } });
      if (!supplier) throw new ORPCError('NOT_FOUND', { message: 'ไม่พบผู้จัดจำหน่าย' });
      return supplier;
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.suppliers.create)
  create() {
    return implement(contract.suppliers.create).handler(async ({ input }) => {
      try {
        return await this.prisma.supplier.create({ data: input });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ORPCError('CONFLICT', { message: 'รหัสผู้จัดจำหน่ายนี้มีอยู่แล้ว' });
        }
        throw error;
      }
    });
  }

  @Roles('ADMINISTRATOR')
  @Implement(contract.suppliers.update)
  update() {
    return implement(contract.suppliers.update).handler(async ({ input }) => {
      const { id, ...data } = input;
      try {
        return await this.prisma.supplier.update({ where: { id }, data });
      } catch (error) {
        if (isRecordNotFound(error)) {
          throw new ORPCError('NOT_FOUND', { message: 'ไม่พบผู้จัดจำหน่าย' });
        }
        throw error;
      }
    });
  }
}
