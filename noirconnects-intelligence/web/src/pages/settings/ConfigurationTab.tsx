import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ConfigChange, IntelligenceConfig, SettingsResponse, RankingWeights } from '../../lib/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, Input, Modal, Notice, Select, Textarea, useToast } from '../../components/ui';
import { DISCOVERY_MODE_LABELS, FREQUENCY_LABELS, SETTING_LABELS, formatDateTime } from '../../lib/format';
import { ChangeTable, displaySetting } from './ChangeTable';

function diff(from: IntelligenceConfig, to: IntelligenceConfig): ConfigChange[] {
  return (Object.keys(to) as (keyof IntelligenceConfig)[])
    .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
    .map((k) => ({ key: k, from: from[k], to: to[k] }));
}

const WEIGHT_LABELS: Record<keyof RankingWeights, string> = {
  relevance: 'Audience & brand relevance',
  engagement: 'Engagement & reach',
  contentQuality: 'Content quality',
  sponsorshipSuitability: 'Sponsorship suitability',
  budgetPracticality: 'Budget & campaign practicality',
};

export function ConfigurationTab({ settings, onSubmitted }: { settings: SettingsResponse; onSubmitted: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const active = settings.active.config;
  const [draft, setDraft] = useState<IntelligenceConfig | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPropose = can('settings.propose');
  const canSensitive = can('settings.propose_sensitive');
  const changes = useMemo(() => (draft ? diff(active, draft) : []), [active, draft]);
  const weightSum = draft ? Object.values(draft.creatorRankingWeights).reduce((a, b) => a + b, 0) : 100;

  const set = <K extends keyof IntelligenceConfig>(key: K, value: IntelligenceConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const submit = async () => {
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = Object.fromEntries(changes.map((c) => [c.key, c.to]));
      const res = await api.post<{ request: { id: number } }>('/api/settings/change-requests', { changes: payload, reason: reason || null });
      toast('success', `Change request #${res.request.id} submitted. It takes effect only after an administrator approves it.`);
      setReviewOpen(false);
      setDraft(null);
      setReason('');
      onSubmitted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile label="Current configuration version" value={`v${settings.active.version}`} sub={`Approved ${formatDateTime(settings.active.createdAt)}${settings.active.approvedBy ? ` by ${settings.active.approvedBy}` : ' (initial)'}`} />
        <StatusTile label="Research scheduling status" value="Not configured" sub={settings.researchScheduling.detail} />
        <StatusTile
          label="Last successful research run"
          value={settings.lastSuccessfulResearchRun ? formatDateTime(settings.lastSuccessfulResearchRun.completed_at) : 'None yet'}
          sub={settings.lastSuccessfulResearchRun ? `${settings.lastSuccessfulResearchRun.records_imported} records · config v${settings.lastSuccessfulResearchRun.settings_version}` : 'No research has been imported.'}
        />
      </div>

      {settings.pendingCount > 0 && !draft && (
        <Notice>
          {settings.pendingCount} change request{settings.pendingCount === 1 ? ' is' : 's are'} awaiting review. Approving one supersedes
          the others, since they were drafted against the current version.
        </Notice>
      )}

      {!draft ? (
        <Card>
          <CardHeader
            title="Active configuration"
            description={`Effective niche: ${settings.active.effectiveNiche}. Future discovery runs use this version; existing runs keep their own snapshot.`}
            actions={canPropose ? <Button variant="primary" onClick={() => setDraft(structuredClone(active))}>Propose a change</Button> : undefined}
          />
          <dl className="divide-y divide-line text-sm">
            {(Object.keys(active) as (keyof IntelligenceConfig)[]).map((k) => (
              <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                <dt className="flex items-center gap-1.5 text-mute">
                  {settings.lockedKeys.includes(k) && <Lock className="size-3.5" aria-label="Locked" />}
                  {SETTING_LABELS[k] ?? k}
                </dt>
                <dd className="font-medium">{displaySetting(k, active[k])}</dd>
              </div>
            ))}
          </dl>
          {!canPropose && <div className="border-t border-line px-5 py-3 text-xs text-mute">Your role can view settings but cannot propose changes.</div>}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Propose a configuration change"
            description="Edit the values below, then review the differences. Nothing is saved until you submit, and nothing takes effect until an administrator approves."
          />
          <div className="grid gap-5 p-5 sm:grid-cols-2">
            <Field label="Active niche" htmlFor="niche">
              <Select
                id="niche"
                value={draft.activeNiche}
                onChange={(e) => setDraft({ ...draft, activeNiche: e.target.value, customNiche: e.target.value === 'Custom' ? (draft.customNiche ?? '') : null })}
              >
                {settings.options.niches.map((n) => <option key={n}>{n}</option>)}
              </Select>
            </Field>
            {draft.activeNiche === 'Custom' && (
              <Field label="Custom niche" htmlFor="customNiche" hint="2–80 characters">
                <Input id="customNiche" value={draft.customNiche ?? ''} onChange={(e) => set('customNiche', e.target.value)} />
              </Field>
            )}
            <Field label="Daily brand discovery target" htmlFor="target" hint="A target, not a quota — unverified brands are never added to reach it.">
              <Input id="target" type="number" min={1} max={100} value={draft.dailyBrandTarget} onChange={(e) => set('dailyBrandTarget', Number(e.target.value))} />
            </Field>
            <Field label="Target geography" htmlFor="geo">
              <Input id="geo" value={draft.targetGeography} onChange={(e) => set('targetGeography', e.target.value)} />
            </Field>
            <Field label="Target language" htmlFor="lang">
              <Input id="lang" value={draft.targetLanguage} onChange={(e) => set('targetLanguage', e.target.value)} />
            </Field>
            <Field label="Research frequency" htmlFor="freq">
              <Select id="freq" value={draft.researchFrequency} onChange={(e) => set('researchFrequency', e.target.value as IntelligenceConfig['researchFrequency'])}>
                {settings.options.researchFrequencies.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f] ?? f}</option>)}
              </Select>
            </Field>
            <Field label="Discovery mode" htmlFor="mode">
              <Select id="mode" value={draft.discoveryMode} onChange={(e) => set('discoveryMode', e.target.value as IntelligenceConfig['discoveryMode'])}>
                {settings.options.discoveryModes.map((m) => <option key={m} value={m}>{DISCOVERY_MODE_LABELS[m] ?? m}</option>)}
              </Select>
            </Field>
            <Field label="Minimum brand quality score" htmlFor="minq" hint="0–100">
              <Input id="minq" type="number" min={0} max={100} value={draft.minBrandQualityScore} onChange={(e) => set('minBrandQualityScore', Number(e.target.value))} />
            </Field>
            <Field label="Sponsorship evidence recency (months)" htmlFor="recency" hint="Prefer evidence newer than this.">
              <Input id="recency" type="number" min={1} max={60} value={draft.sponsorshipRecencyMonths} onChange={(e) => set('sponsorshipRecencyMonths', Number(e.target.value))} />
            </Field>
            <Field label="Creators per research assignment" htmlFor="cpa">
              <Input id="cpa" type="number" min={1} max={50} value={draft.creatorsPerResearchAssignment} onChange={(e) => set('creatorsPerResearchAssignment', Number(e.target.value))} />
            </Field>
            <Field label="Business time zone" htmlFor="tz" hint={canSensitive ? 'IANA name, e.g. Europe/London. Used for “today” and business days.' : 'Administrators only.'}>
              <Input id="tz" value={draft.businessTimeZone} disabled={!canSensitive} onChange={(e) => set('businessTimeZone', e.target.value)} />
            </Field>
            <div className="flex items-end">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-black"
                  checked={draft.requireCreatorAvailabilityConfirmation}
                  onChange={(e) => set('requireCreatorAvailabilityConfirmation', e.target.checked)}
                />
                Require creator availability confirmation before a proposal is sent
              </label>
            </div>
          </div>

          <div className="border-t border-line p-5">
            <h3 className="text-sm font-semibold">Creator ranking weights</h3>
            <p className={`mt-0.5 text-xs ${weightSum === 100 ? 'text-mute' : 'text-red-700'}`}>Must total 100%. Current total: {weightSum}%</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.keys(WEIGHT_LABELS) as (keyof RankingWeights)[]).map((k) => (
                <Field key={k} label={WEIGHT_LABELS[k]} htmlFor={`w-${k}`}>
                  <Input id={`w-${k}`} type="number" min={0} max={100} value={draft.creatorRankingWeights[k]} onChange={(e) => set('creatorRankingWeights', { ...draft.creatorRankingWeights, [k]: Number(e.target.value) })} />
                </Field>
              ))}
            </div>
          </div>

          <div className="border-t border-line p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              Follow-up policy {!canSensitive && <Badge>Administrators only</Badge>}
            </h3>
            <p className="mt-0.5 text-xs text-mute">Weekends are excluded and every follow-up requires approval — these are fixed.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['firstFollowUpBusinessDays', 'First follow-up (business days after initial email)', 1, 30],
                ['secondFollowUpBusinessDays', 'Second follow-up (business days after first)', 1, 30],
                ['maxFollowUps', 'Maximum follow-ups', 0, 2],
                ['dormantAfterBusinessDays', 'Dormant after final follow-up (business days)', 1, 60],
              ] as const).map(([k, label, min, max]) => (
                <Field key={k} label={label} htmlFor={`fu-${k}`}>
                  <Input id={`fu-${k}`} type="number" min={min} max={max} disabled={!canSensitive} value={draft.followUpPolicy[k]} onChange={(e) => set('followUpPolicy', { ...draft.followUpPolicy, [k]: Number(e.target.value) })} />
                </Field>
              ))}
            </div>
          </div>

          <div className="border-t border-line p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Lock className="size-3.5" /> Operating safeguards</h3>
            <p className="mt-1 text-sm text-mute">Automatic external communication: <strong className="text-ink">Disabled</strong> · Human approval: <strong className="text-ink">Mandatory</strong>. These cannot be changed.</p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <p className="text-sm text-mute">{changes.length === 0 ? 'No changes yet.' : `${changes.length} setting${changes.length === 1 ? '' : 's'} changed.`}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
              <Button variant="primary" disabled={changes.length === 0} onClick={() => { setError(null); setReviewOpen(true); }}>Review changes</Button>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Submit for administrator approval"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>Back to editing</Button>
            <Button variant="primary" loading={submitting} onClick={() => void submit()}>Submit change request</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <ErrorBanner message={error} />}
          <p className="text-sm text-mute">
            Based on version v{settings.active.version}. If approved, this becomes version v{settings.active.version + 1}.
          </p>
          <ChangeTable changes={changes} />
          <Field label="Reason (optional)" htmlFor="reason">
            <Textarea id="reason" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function StatusTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-mute">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-mute">{sub}</p>
    </div>
  );
}
