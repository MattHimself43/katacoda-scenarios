import { Link } from 'react-router-dom';
import { Badge, Card, CardHeader, ErrorBanner, PageHeader, Spinner } from '../components/ui';
import { useApi } from '../lib/useApi';
import type { Overview } from '../lib/types';
import { formatDateTime } from '../lib/format';

const METRICS: { key: keyof Overview['metrics']; label: string; to: string }[] = [
  { key: 'brandsDiscoveredToday', label: 'Brands discovered today', to: '/brand-discovery' },
  { key: 'brandsAwaitingApproval', label: 'Brands awaiting approval', to: '/brand-approvals' },
  { key: 'emailDraftsAwaitingApproval', label: 'Email drafts awaiting approval', to: '/outreach' },
  { key: 'emailsSent', label: 'Emails sent', to: '/outreach' },
  { key: 'responsesReceived', label: 'Responses received', to: '/inbox' },
  { key: 'followUpsDue', label: 'Follow-ups due', to: '/follow-ups' },
  { key: 'brandsRequestingCreators', label: 'Brands requesting creator recommendations', to: '/creator-discovery' },
  { key: 'shortlistsAwaitingApproval', label: 'Creator shortlists awaiting approval', to: '/shortlists' },
  { key: 'proposalsAwaitingApproval', label: 'Proposals awaiting approval', to: '/proposals' },
  { key: 'dormantOutreach', label: 'Dormant outreach records', to: '/dormant' },
];

const INTEGRATION_LABELS = { mail: 'Hostinger Mail', research: 'Claude research sync', scheduler: 'Job scheduler' } as const;

export function OverviewPage() {
  const { data, error, loading } = useApi<Overview>('/api/overview');

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          data
            ? `Counts are read from the database. Updated ${formatDateTime(data.generatedAt)} · day boundary ${data.timeZone}.`
            : 'Counts are read from the database.'
        }
      />
      {error && <ErrorBanner message={error} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="space-y-6">
          {data.pendingSettingsChanges > 0 && (
            <Link
              to="/settings?tab=requests"
              className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 hover:border-amber-300"
            >
              <span>
                {data.pendingSettingsChanges} settings change{data.pendingSettingsChanges === 1 ? '' : 's'} awaiting administrator review
              </span>
              <span className="font-medium">Review →</span>
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {METRICS.map((m) => (
              <Link key={m.key} to={m.to} className="group rounded-2xl border border-line bg-white p-4 transition hover:border-neutral-400">
                <p className="tabular text-[28px] font-semibold leading-none tracking-tight">{data.metrics[m.key]}</p>
                <p className="mt-2 text-[13px] leading-snug text-mute group-hover:text-ink">{m.label}</p>
              </Link>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Active research configuration" />
              <dl className="divide-y divide-line text-sm">
                <Row label="Configuration version" value={`v${data.configuration.version}`} />
                <Row label="Active niche" value={data.configuration.niche} />
                <Row label="Daily brand target" value={`${data.configuration.dailyBrandTarget} (target, not a quota)`} />
                <Row
                  label="Last successful research run"
                  value={
                    data.lastSuccessfulResearchRun
                      ? `${formatDateTime(data.lastSuccessfulResearchRun.completed_at)} · ${data.lastSuccessfulResearchRun.records_imported} imported`
                      : 'None yet'
                  }
                />
              </dl>
              <div className="border-t border-line px-5 py-3 text-right">
                <Link to="/settings" className="text-sm font-medium hover:underline">
                  Intelligence Settings →
                </Link>
              </div>
            </Card>

            <Card>
              <CardHeader title="Integrations" description="Shown as connected only after a verified end-to-end test." />
              <ul className="divide-y divide-line">
                {(Object.keys(data.integrations) as (keyof Overview['integrations'])[]).map((k) => (
                  <li key={k} className="flex items-start justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{INTEGRATION_LABELS[k]}</p>
                      <p className="mt-0.5 text-xs text-mute">{data.integrations[k].detail}</p>
                    </div>
                    <Badge>{data.integrations[k].status === 'NOT_CONFIGURED' ? 'Not configured' : data.integrations[k].status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-mute">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
