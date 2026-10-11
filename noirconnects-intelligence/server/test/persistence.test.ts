import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setupEnv, loginAs, type TestEnv } from './helpers.js';
import { initDatabase } from '../src/bootstrap.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { approveSettingsChange, getActiveSettings, listChangeRequests, proposeSettingsChange } from '../src/services/settings.js';

let env: TestEnv | undefined;
afterEach(() => env?.cleanup());

describe('restart persistence', () => {
  it('all state survives closing and reopening the database', async () => {
    env = await setupEnv();
    const now = env.clock.now();
    const r1 = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Sports' }, null, now);
    approveSettingsChange(env.db, env.users.owner, r1.id, r1.content_hash!, null, now);
    proposeSettingsChange(env.db, env.users.manager, { dailyBrandTarget: 9 }, 'pending across restart', now);
    const auditCount = (env.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n;
    env.db.close();

    // "Restart": reopen the same file, re-run migrations and bootstrap.
    const db2 = initDatabase(env.dbPath, now);
    env.db = db2;
    expect(getActiveSettings(db2).version).toBe(2);
    expect(getActiveSettings(db2).config.activeNiche).toBe('Sports');
    const pending = listChangeRequests(db2, { status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.reason).toBe('pending across restart');
    expect((db2.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n).toBeGreaterThanOrEqual(auditCount);
    expect((db2.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(5);

    // Users can still log in against the reopened database and the pending change is approvable.
    const app2 = createApp({ db: db2, clock: env.clock.now });
    const o = await loginAs(app2, 'owner@example.test');
    const res = await o.post(`/api/settings/change-requests/${pending[0]!.id}/approve`, { reviewedHash: pending[0]!.content_hash });
    expect(res.status).toBe(200);
    expect(getActiveSettings(db2).version).toBe(3);
  });

  it('migrations are idempotent and do not re-seed settings', async () => {
    env = await setupEnv();
    expect(migrate(env.db).applied).toEqual([]);
    const db2 = initDatabase(env.dbPath);
    expect((db2.prepare('SELECT COUNT(*) AS n FROM settings_versions').get() as { n: number }).n).toBe(1);
    db2.close();
  });

  it('refuses to run if an applied migration was modified', () => {
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations');
    const dir = mkdtempSync(join(tmpdir(), 'nc-mig-'));
    for (const f of readdirSync(migrationsDir)) copyFileSync(join(migrationsDir, f), join(dir, f));
    const db = openDatabase(join(dir, 'm.db'));
    migrate(db, dir);
    writeFileSync(join(dir, '001_initial_schema.sql'), '-- tampered\n', { flag: 'a' });
    expect(() => migrate(db, dir)).toThrow(/modified after being applied/);
    db.close();
  });

  it('audit logs are append-only', async () => {
    env = await setupEnv();
    expect(() => env!.db.prepare('UPDATE audit_logs SET action = ?').run('X')).toThrow(/append-only/);
    expect(() => env!.db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });
});
