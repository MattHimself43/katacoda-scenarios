import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { loginAs, PASSWORD, setupEnv, type TestEnv } from './helpers.js';
import { updateUser } from '../src/services/users.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

describe('authentication', () => {
  it('rejects unauthenticated API access', async () => {
    const res = await request(env.app).get('/api/overview');
    expect(res.status).toBe(401);
  });

  it('logs in, returns the current user and permissions, and logs out', async () => {
    const a = await loginAs(env.app, 'owner@example.test');
    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('ADMIN');
    expect(me.body.permissions).toContain('settings.approve');
    await a.post('/api/auth/logout');
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('sets an httpOnly SameSite=Strict session cookie', async () => {
    const res = await request(env.app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'NoirConnects')
      .send({ email: 'owner@example.test', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejects wrong passwords and unknown users with the same message', async () => {
    const h = { 'X-Requested-With': 'NoirConnects' };
    const bad = await request(env.app).post('/api/auth/login').set(h).send({ email: 'owner@example.test', password: 'wrong-password-xx' });
    const unknown = await request(env.app).post('/api/auth/login').set(h).send({ email: 'nobody@example.test', password: 'wrong-password-xx' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('rate-limits repeated failed logins', async () => {
    const h = { 'X-Requested-With': 'NoirConnects' };
    for (let i = 0; i < 8; i++) {
      await request(env.app).post('/api/auth/login').set(h).send({ email: 'owner@example.test', password: 'wrong-password-xx' });
    }
    const res = await request(env.app).post('/api/auth/login').set(h).send({ email: 'owner@example.test', password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('requires the CSRF verification header on state-changing requests', async () => {
    const res = await request(env.app).post('/api/auth/login').send({ email: 'owner@example.test', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('expires sessions after their TTL', async () => {
    const a = await loginAs(env.app, 'owner@example.test');
    env.clock.advance(13 * 3600_000);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('immediately revokes sessions of deactivated users', async () => {
    const a = await loginAs(env.app, 'manager@example.test');
    expect((await a.get('/api/overview')).status).toBe(200);
    updateUser(env.db, env.users.owner, env.users.manager.userId, { isActive: false }, env.clock.now());
    expect((await a.get('/api/overview')).status).toBe(401);
    const relogin = await request(env.app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'NoirConnects')
      .send({ email: 'manager@example.test', password: PASSWORD });
    expect(relogin.status).toBe(401);
  });
});

describe('authentication audit trail', () => {
  it('attributes successful logins to the user and failed logins to the system', async () => {
    await loginAs(env.app, 'manager@example.test');
    await request(env.app).post('/api/auth/login').set('X-Requested-With', 'NoirConnects').send({ email: 'manager@example.test', password: 'wrong-password-xx' });
    const rows = env.db
      .prepare(`SELECT action, actor_type, actor_user_id FROM audit_logs WHERE action LIKE 'LOGIN_%' ORDER BY id`)
      .all() as { action: string; actor_type: string; actor_user_id: number | null }[];
    expect(rows).toEqual([
      { action: 'LOGIN_SUCCEEDED', actor_type: 'USER', actor_user_id: env.users.manager.userId },
      { action: 'LOGIN_FAILED', actor_type: 'SYSTEM', actor_user_id: null },
    ]);
  });
});
