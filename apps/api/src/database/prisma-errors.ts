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
