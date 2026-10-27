import { ORPCError } from '@orpc/nest';

/** Helpers for the Prisma known-request-error codes we map to oRPC errors. */

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** P2002: a unique constraint (e.g. a SKU or supplier code) was violated. */
export function isUniqueViolation(error: unknown): boolean {
  return hasCode(error, 'P2002');
}

/** P2025: the record to update or delete does not exist. */
export function isRecordNotFound(error: unknown): boolean {
  return hasCode(error, 'P2025');
}

/**
 * Run a Prisma write and translate the two errors our master-data writes expect into actionable
 * oRPC errors with Thai messages: a unique-constraint clash becomes CONFLICT, a missing row
 * becomes NOT_FOUND. Anything else propagates unchanged.
 */
export async function mapWriteErrors<T>(
  write: () => Promise<T>,
  messages: { conflict: string; notFound: string },
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ORPCError('CONFLICT', { message: messages.conflict });
    if (isRecordNotFound(error)) throw new ORPCError('NOT_FOUND', { message: messages.notFound });
    throw error;
  }
}
