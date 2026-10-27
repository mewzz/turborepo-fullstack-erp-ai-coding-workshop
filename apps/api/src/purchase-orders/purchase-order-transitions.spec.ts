import type { PurchaseOrderStatus } from '@erp/contracts';
import { describe, expect, it } from 'vitest';
import { nextStatus, type TransitionActor } from './purchase-order-transitions.js';

const creator: TransitionActor = { role: 'PURCHASING_OFFICER', isCreator: true };
const otherOfficer: TransitionActor = { role: 'PURCHASING_OFFICER', isCreator: false };
const manager: TransitionActor = { role: 'MANAGER', isCreator: false };
const managerCreator: TransitionActor = { role: 'MANAGER', isCreator: true };

const RECEIVED_STATUSES: PurchaseOrderStatus[] = ['PARTIALLY_RECEIVED', 'COMPLETED'];

describe('submit (Draft→Pending, creator only, PO-02)', () => {
  it('moves a draft to pending for the creator', () => {
    expect(nextStatus('submit', 'DRAFT', creator)).toBe('PENDING_APPROVAL');
  });

  it('forbids a non-creator from submitting', () => {
    expect(() => nextStatus('submit', 'DRAFT', otherOfficer)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('forbids a manager who is not the creator', () => {
    expect(() => nextStatus('submit', 'DRAFT', manager)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects submitting from any non-draft status', () => {
    for (const status of ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(() => nextStatus('submit', status, creator)).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });
});

describe('approve (Pending→Approved, manager only, PO-02)', () => {
  it('moves a pending order to approved for a manager', () => {
    expect(nextStatus('approve', 'PENDING_APPROVAL', manager)).toBe('APPROVED');
  });

  it('forbids the creating purchasing officer from approving', () => {
    expect(() => nextStatus('approve', 'PENDING_APPROVAL', creator)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects approving from a non-pending status', () => {
    for (const status of ['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(() => nextStatus('approve', status, manager)).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });
});

describe('reject (Pending→Rejected, manager, reason required, PO-03)', () => {
  it('moves a pending order to rejected with a reason', () => {
    expect(nextStatus('reject', 'PENDING_APPROVAL', manager, 'ราคาสูงไป')).toBe('REJECTED');
  });

  it('requires a non-blank reason', () => {
    expect(() => nextStatus('reject', 'PENDING_APPROVAL', manager, '   ')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(() => nextStatus('reject', 'PENDING_APPROVAL', manager)).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('forbids a non-manager from rejecting', () => {
    expect(() => nextStatus('reject', 'PENDING_APPROVAL', creator, 'reason')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects rejecting from a non-pending status', () => {
    for (const status of ['DRAFT', 'APPROVED', 'REJECTED', 'CANCELLED'] as const) {
      expect(() => nextStatus('reject', status, manager, 'reason')).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });
});

describe('cancel (Draft|Pending→Cancelled, creator or manager, reason, PO-04)', () => {
  it('cancels a draft for the creator with a reason', () => {
    expect(nextStatus('cancel', 'DRAFT', creator, 'ยกเลิก')).toBe('CANCELLED');
  });

  it('cancels a pending order for a manager with a reason', () => {
    expect(nextStatus('cancel', 'PENDING_APPROVAL', manager, 'ยกเลิก')).toBe('CANCELLED');
  });

  it('lets a manager who authored the order cancel their own draft', () => {
    expect(nextStatus('cancel', 'DRAFT', managerCreator, 'ยกเลิก')).toBe('CANCELLED');
  });

  it('requires a reason', () => {
    expect(() => nextStatus('cancel', 'DRAFT', creator, '')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('forbids a non-creator, non-manager from cancelling', () => {
    expect(() => nextStatus('cancel', 'DRAFT', otherOfficer, 'ยกเลิก')).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('rejects cancelling an approved order (PO-04, out of scope)', () => {
    expect(() => nextStatus('cancel', 'APPROVED', manager, 'ยกเลิก')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });

  it('rejects cancelling a received order (PO-04, out of scope)', () => {
    for (const status of RECEIVED_STATUSES) {
      expect(() => nextStatus('cancel', status, manager, 'ยกเลิก')).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });

  it('rejects cancelling an already rejected or cancelled order', () => {
    for (const status of ['REJECTED', 'CANCELLED'] as const) {
      expect(() => nextStatus('cancel', status, manager, 'ยกเลิก')).toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }),
      );
    }
  });
});
