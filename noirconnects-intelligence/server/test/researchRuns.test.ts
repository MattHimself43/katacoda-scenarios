import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { getResearchRun, startResearchRun } from '../src/services/researchRuns.js';
import { approveSettingsChange, proposeSettingsChange } from '../src/services/settings.js';

let env: TestEnv;
beforeEach(async () => { env = await setupEnv(); });
afterEach(() => env.cleanup());

describe('discovery run configuration snapshots', () => {
  it('pins each run to the configuration version active when it started', () => {
    const now = env.clock.now();
    const run1 = startResearchRun(env.db, env.users.researcher, { runType: 'BRAND_DISCOVERY', source: 'MANUAL_IMPORT' }, now);
    expect(run1.settings_version).toBe(1);
    expect(run1.config_snapshot.activeNiche).toBe('Gaming');

    const req = proposeSettingsChange(env.db, env.users.owner, { activeNiche: 'Fitness', dailyBrandTarget: 12 }, null, now);
    approveSettingsChange(env.db, env.users.owner, req.id, req.content_hash!, null, now);

    // Existing run keeps its original snapshot.
    const reread = getResearchRun(env.db, run1.id)!;
    expect(reread.settings_version).toBe(1);
    expect(reread.config_snapshot.activeNiche).toBe('Gaming');
    expect(reread.config_snapshot.dailyBrandTarget).toBe(15);

    // New runs use the newly approved configuration.
    const run2 = startResearchRun(env.db, 'SCHEDULER', { runType: 'BRAND_DISCOVERY', source: 'SCHEDULED_IMPORT' }, now);
    expect(run2.settings_version).toBe(2);
    expect(run2.config_snapshot.activeNiche).toBe('Fitness');
  });

  it('a pending (unapproved) change never affects new runs', () => {
    const now = env.clock.now();
    proposeSettingsChange(env.db, env.users.manager, { activeNiche: 'Fitness' }, null, now);
    const run = startResearchRun(env.db, env.users.researcher, { runType: 'BRAND_DISCOVERY', source: 'MANUAL_IMPORT' }, now);
    expect(run.config_snapshot.activeNiche).toBe('Gaming');
  });

  it('the snapshot is immutable at the database level', () => {
    const run = startResearchRun(env.db, env.users.researcher, { runType: 'BRAND_DISCOVERY', source: 'MANUAL_IMPORT' }, env.clock.now());
    expect(() => env.db.prepare('UPDATE research_runs SET config_snapshot_json = ? WHERE id = ?').run('{}', run.id)).toThrow(/immutable/);
    expect(() => env.db.prepare('UPDATE research_runs SET settings_version_id = 99 WHERE id = ?').run(run.id)).toThrow(/immutable/);
    // Non-snapshot fields can still be updated as the run progresses.
    env.db.prepare(`UPDATE research_runs SET status = 'IMPORTED' WHERE id = ?`).run(run.id);
  });

  it('viewers cannot start research runs', () => {
    expect(() => startResearchRun(env.db, env.users.viewer, { runType: 'BRAND_DISCOVERY', source: 'MANUAL_IMPORT' }, env.clock.now())).toThrow(/cannot start/);
  });
});
