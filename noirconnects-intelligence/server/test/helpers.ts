import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase } from '../src/bootstrap.js';
import type { DB } from '../src/db/connection.js';
import { createOwner, createUser } from '../src/services/users.js';
import type { Actor } from '../src/auth/actor.js';
import type { Role } from '../src/domain/statuses.js';

export const PASSWORD = 'test-password-123456';

export class TestClock {
  constructor(public current = new Date('2026-03-02T10:00:00.000Z')) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function tempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'nc-test-'));
  return { path: join(dir, 'test.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface TestEnv {
  db: DB;
  clock: TestClock;
  dbPath: string;
  users: Record<'owner' | 'admin2' | 'manager' | 'researcher' | 'viewer', Actor>;
  app: ReturnType<typeof createApp>;
  cleanup: () => void;
}

export async function setupEnv(): Promise<TestEnv> {
  const clock = new TestClock();
  const tmp = tempDbPath();
  const db = initDatabase(tmp.path, clock.now());
  const ownerRec = await createOwner(db, { email: 'owner@example.test', displayName: 'Owner', password: PASSWORD }, clock.now());
  const owner: Actor = { userId: ownerRec.id, email: ownerRec.email, displayName: 'Owner', role: 'ADMIN', isOwner: true };
  const mk = async (email: string, role: Role): Promise<Actor> => {
    const u = await createUser(db, owner, { email, displayName: email.split('@')[0]!, role, password: PASSWORD }, clock.now());
    return { userId: u.id, email: u.email, displayName: u.display_name, role, isOwner: false };
  };
  const users = {
    owner,
    admin2: await mk('admin2@example.test', 'ADMIN'),
    manager: await mk('manager@example.test', 'MANAGER'),
    researcher: await mk('researcher@example.test', 'RESEARCHER'),
    viewer: await mk('viewer@example.test', 'VIEWER'),
  };
  const app = createApp({ db, clock: clock.now });
  return {
    db,
    clock,
    dbPath: tmp.path,
    users,
    app,
    cleanup: () => {
      if (db.open) db.close();
      tmp.cleanup();
    },
  };
}

/** Logged-in supertest agent that sends the CSRF verification header. */
export async function loginAs(app: TestEnv['app'], email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'NoirConnects').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const h = { 'X-Requested-With': 'NoirConnects' };
  return {
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(h).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set(h).send(body ?? {}),
    raw: agent,
  };
}

export function auditActions(db: DB): string[] {
  return (db.prepare('SELECT action FROM audit_logs ORDER BY id').all() as { action: string }[]).map((r) => r.action);
}
