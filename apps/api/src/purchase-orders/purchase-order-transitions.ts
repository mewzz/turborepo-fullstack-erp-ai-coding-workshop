import type { PurchaseOrderStatus, Role } from '@erp/contracts';
import { ORPCError } from '@orpc/nest';

/**
 * The guarded purchase-order transitions (PO-02/03/04), kept pure and apart from Prisma so every
 * legal and illegal move can be asserted directly. Each action names the statuses it may run from,
 * the status it produces, who may run it, and whether a reason is required. The two received
 * statuses belong to goods receiving (T6) and are never produced here.
 */

export type PurchaseOrderAction = 'submit' | 'approve' | 'reject' | 'cancel';

/** The actor as the guards need to see them: their role and whether they authored the order. */
export interface TransitionActor {
  role: Role;
  isCreator: boolean;
}

const MESSAGES = {
  forbidden: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
  illegal: 'ไม่สามารถดำเนินการกับสถานะปัจจุบันได้',
  reasonRequired: 'กรุณาระบุเหตุผล',
};

/**
 * Whether `role` (with authorship `isCreator`) may run `action`. The author submits and may cancel;
 * only a manager approves or rejects; either the author or a manager may cancel (PO-02/03/04).
 */
function mayAct(action: PurchaseOrderAction, actor: TransitionActor): boolean {
  switch (action) {
    case 'submit':
      return actor.isCreator;
    case 'approve':
    case 'reject':
      return actor.role === 'MANAGER';
    case 'cancel':
      return actor.isCreator || actor.role === 'MANAGER';
  }
}

/** The statuses each action may run from, and the status it produces. */
const TRANSITIONS: Record<
  PurchaseOrderAction,
  { from: PurchaseOrderStatus[]; to: PurchaseOrderStatus; reasonRequired: boolean }
> = {
  submit: { from: ['DRAFT'], to: 'PENDING_APPROVAL', reasonRequired: false },
  approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED', reasonRequired: false },
  reject: { from: ['PENDING_APPROVAL'], to: 'REJECTED', reasonRequired: true },
  cancel: { from: ['DRAFT', 'PENDING_APPROVAL'], to: 'CANCELLED', reasonRequired: true },
};

/**
 * Validate a transition and return the next status, or throw the matching oRPC error: FORBIDDEN
 * when the role or authorship is wrong, BAD_REQUEST when the current status does not allow the
 * action or a required reason is missing. Authorship is checked before status so a stranger never
 * learns an order's state.
 */
export function nextStatus(
  action: PurchaseOrderAction,
  current: PurchaseOrderStatus,
  actor: TransitionActor,
  reason?: string,
): PurchaseOrderStatus {
  if (!mayAct(action, actor)) {
    throw new ORPCError('FORBIDDEN', { message: MESSAGES.forbidden });
  }
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new ORPCError('BAD_REQUEST', { message: MESSAGES.illegal });
  }
  if (rule.reasonRequired && !reason?.trim()) {
    throw new ORPCError('BAD_REQUEST', { message: MESSAGES.reasonRequired });
  }
  return rule.to;
}
