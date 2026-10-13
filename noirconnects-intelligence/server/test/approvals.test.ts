import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import {
  cancelApproval,
  consumeApproval,
  createApproval,
  decideApproval,
  expireDueApprovals,
  getApproval,
} from '../src/services/approvals.js';
import { hashContent } from '../src/lib/util.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

const action = { recipient: 'brand@example.test', subject: 'Hello', body: 'Draft v1', attachments: [] };

function newApproval(overrides: Partial<Parameters<typeof createApproval>[2]> = {}) {
  return createApproval(
    env.db,
    env.users.manager,
    { actionType: 'TEST_SEND', targetEntityType: 'draft', targetEntityId: 1, proposedAction: action, ...overrides },
    env.clock.now(),
  );
}

describe('universal approval engine', () => {
  it('records all required fields', () => {
    const a = newApproval();
    expect(a).toMatchObject({
      action_type: 'TEST_SEND',
      target_entity_type: 'draft',
      target_entity_id: '1',
      status: 'PENDING',
      required_role: 'ADMIN',
      requested_by: env.users.manager.userId,
      content_hash: hashContent(action),
    });
    expect(a.proposed_action).toEqual(action);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('only allows one live approval per target and action', () => {
    newApproval();
    expect(() => newApproval()).toThrow(/already open/);
  });

  it('enforces the required role', () => {
    const a = newApproval();
    expect(() => decideApproval(env.db, env.users.manager, a.id, 'APPROVE', { reviewedHash: a.content_hash }, env.clock.now())).toThrow(/Only administrators/);
    const m = newApproval({ targetEntityId: 2, requiredRole: 'MANAGER' });
    expect(decideApproval(env.db, env.users.manager, m.id, 'APPROVE', { reviewedHash: m.content_hash }, env.clock.now()).status).toBe('APPROVED');
    const r = newApproval({ targetEntityId: 3, requiredRole: 'MANAGER' });
    expect(() => decideApproval(env.db, env.users.researcher, r.id, 'APPROVE', { reviewedHash: r.content_hash }, env.clock.now())).toThrow(/Only managers/);
  });

  it('executes only the exact approved content, exactly once', () => {
    const a = newApproval();
    const now = env.clock.now();
    expect(() => consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: action }, null, now)).toThrow(/PENDING, not APPROVED/);
    decideApproval(env.db, env.users.owner, a.id, 'APPROVE', { reviewedHash: a.content_hash }, now);
    expect(() =>
      consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: { ...action, body: 'Edited after approval' } }, null, now),
    ).toThrow(/differs from the approved content/);
    expect(() => consumeApproval(env.db, a.id, { actionType: 'OTHER', currentAction: action }, null, now)).toThrow(/action type/);
    expect(consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: action }, { ok: 1 }, now).status).toBe('EXECUTED');
    expect(() => consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: action }, null, now)).toThrow(/EXECUTED/);
  });

  it('cannot be decided twice or after cancellation', () => {
    const a = newApproval();
    decideApproval(env.db, env.users.owner, a.id, 'REJECT', { notes: 'no' }, env.clock.now());
    expect(() => decideApproval(env.db, env.users.owner, a.id, 'APPROVE', { reviewedHash: a.content_hash }, env.clock.now())).toThrow(/already REJECTED/);
    const b = newApproval({ targetEntityId: 9 });
    expect(cancelApproval(env.db, env.users.manager, b.id, 'draft edited', env.clock.now())).toBe(true);
    expect(() => decideApproval(env.db, env.users.owner, b.id, 'APPROVE', { reviewedHash: b.content_hash }, env.clock.now())).toThrow(/already CANCELLED/);
  });

  it('cancelling an approved-but-unexecuted approval invalidates it', () => {
    const a = newApproval();
    decideApproval(env.db, env.users.owner, a.id, 'APPROVE', { reviewedHash: a.content_hash }, env.clock.now());
    cancelApproval(env.db, 'SYSTEM', a.id, 'Draft edited — approval invalidated', env.clock.now());
    expect(() => consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: action }, null, env.clock.now())).toThrow(/CANCELLED/);
  });

  it('refuses stale (expired) approvals and the expiry job persists EXPIRED', () => {
    const a = newApproval({ expiresAt: new Date(env.clock.now().getTime() + 3600_000) });
    decideApproval(env.db, env.users.owner, a.id, 'APPROVE', { reviewedHash: a.content_hash }, env.clock.now());
    env.clock.advance(2 * 3600_000);
    expect(() => consumeApproval(env.db, a.id, { actionType: 'TEST_SEND', currentAction: action }, null, env.clock.now())).toThrow(/expired/);
    expect(expireDueApprovals(env.db, env.clock.now())).toBe(1);
    expect(getApproval(env.db, a.id)!.status).toBe('EXPIRED');
  });
});
