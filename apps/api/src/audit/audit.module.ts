import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';

/**
 * The cross-cutting audit trail (NFR-03). A read-only module: audit rows are written inside the
 * transactions of the actions they record (the first is a manager stock adjustment), and read back
 * here under a permission check.
 */
@Module({ controllers: [AuditController] })
export class AuditModule {}
