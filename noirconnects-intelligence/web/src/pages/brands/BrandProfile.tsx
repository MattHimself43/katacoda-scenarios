import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ErrorBanner, PageHeader, Spinner, statusTone } from '../../components/ui';
import { ScoreBreakdown, ScorePill } from '../../components/brands/ScoreBreakdown';
import { BrandDecisionModal } from '../../components/brands/BrandDecisionModal';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../lib/auth';
import type { BrandDetail } from '../../lib/types';
import { EVIDENCE_LABELS, brandStatusLabel, safeHref } from '../../lib/brands';
import { formatDateTime } from '../../lib/format';

export function BrandProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<BrandDetail>(`/api/brands/${Number(id)}`);
  const [decision, setDecision] = useState<'approve' | 'decline' | null>(null);

  if (error) return <ErrorBanner message={error} />;
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const b = data.brand;
  const pending = b.status === 'PENDING_BRAND_APPROVAL' && can('brands.decide');

  return (
    <>
      <Link to="/brand-discovery" className="mb-3 inline-block text-sm text-mute hover:text-ink">← Brand Discovery</Link>
      <PageHeader
        title={b.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(b.status)}>{brandStatusLabel(b.status)}</Badge>
            {safeHref(b.website_url) ? (
              <a href={safeHref(b.website_url)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-ink">
                {b.website_domain} <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : b.website_domain}
          </span>
        }
        actions={
          pending ? (
            <>
              <Button variant="danger" onClick={() => setDecision('decline')}>Decline</Button>
              <Button variant="primary" onClick={() => setDecision('approve')}>Approve</Button>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Profile" />
            <dl className="divide-y divide-line text-sm">
              <Row label="Industry / subcategory" value={[b.industry, b.subcategory].filter(Boolean).join(' · ') || '—'} />
              <Row label="Target markets" value={b.target_markets.length ? b.target_markets.join(', ') : '—'} />
              <Row label="Products & services" value={b.products_services ?? '—'} />
              <Row label="Influencer activity" value={b.influencer_activity_summary ?? '—'} />
              <Row label="Why recommended" value={b.recommendation_reason ?? '—'} />
              <Row label="Discovery" value={`${b.discovery_niche} · configuration v${b.settings_version} · research run #${b.research_run_id ?? '—'}`} />
              <Row label="Researched" value={formatDateTime(b.researched_at)} />
              <Row label="Added" value={formatDateTime(b.created_at)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title={`Influencer marketing evidence (${data.evidence.length})`} description="Paid partnerships are distinguished from open affiliate programs." />
            <ul className="divide-y divide-line">
              {data.evidence.map((e) => (
                <li key={e.id} className="space-y-1.5 px-5 py-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.evidence_type === 'AFFILIATE_PROGRAM' || e.evidence_type === 'OTHER' ? 'neutral' : 'dark'}>{EVIDENCE_LABELS[e.evidence_type] ?? e.evidence_type}</Badge>
                    <Badge tone={e.verification_status === 'VERIFIED' ? 'green' : 'amber'}>{e.verification_status === 'VERIFIED' ? 'Verified' : 'Unverified'}</Badge>
                    <span className="text-xs text-mute">{e.evidence_date ?? 'Date unknown'}</span>
                  </div>
                  <p>{e.description}</p>
                  {(e.creator_name || e.platform) && <p className="text-xs text-mute">{[e.creator_name, e.platform].filter(Boolean).join(' · ')}</p>}
                  {safeHref(e.source_url) ? (
                    <a href={safeHref(e.source_url)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 break-all text-xs underline">
                      {e.source_url} <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  ) : (
                    <p className="text-xs text-mute">No source link</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Quality score" actions={<ScorePill score={b.quality_score} />} />
            <div className="p-5"><ScoreBreakdown breakdown={b.quality_breakdown} /></div>
          </Card>

          <Card>
            <CardHeader title="Contact" description="Only verified details should be relied on." />
            <dl className="divide-y divide-line text-sm">
              <Row label="Name" value={<Verified value={b.contact_name} verified={b.contact_name_verified} />} />
              <Row label="Role" value={<Verified value={b.contact_role} verified={b.contact_role_verified} />} />
              <Row label="Email" value={<Verified value={b.contact_email} verified={b.contact_email_verified} />} />
              <Row
                label="Contact page"
                value={safeHref(b.contact_channel_url) ? <a className="underline [overflow-wrap:anywhere]" href={safeHref(b.contact_channel_url)} target="_blank" rel="noopener noreferrer nofollow">{b.contact_channel_url}</a> : 'Not provided'}
              />
            </dl>
          </Card>

          {b.warnings.length > 0 && (
            <Card>
              <CardHeader title="Review notes" />
              <ul className="space-y-1 p-5 text-sm text-amber-800">{b.warnings.map((w) => <li key={w}>! {w}</li>)}</ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Decision history" />
            {data.decisions.length === 0 ? (
              <p className="p-5 text-sm text-mute">
                Awaiting decision{data.approval ? ` · approval requested ${formatDateTime(data.approval.requested_at)}${data.approval.requested_by_name ? ` by ${data.approval.requested_by_name}` : ''}` : ''}.
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.decisions.map((d) => (
                  <li key={d.id} className="px-5 py-3">
                    <p className="font-medium">{d.decision === 'APPROVED' ? 'Approved' : d.decision === 'DECLINED' ? 'Declined' : d.decision} by {d.decided_by}</p>
                    <p className="text-xs text-mute">{formatDateTime(d.decided_at)}</p>
                    {d.notes && <p className="mt-1">“{d.notes}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <BrandDecisionModal
        brandId={decision ? b.id : null}
        kind={decision ?? 'approve'}
        onClose={() => setDecision(null)}
        onDone={() => { setDecision(null); void reload(); }}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
      <dt className="text-mute">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );
}

function Verified({ value, verified }: { value: string | null; verified: number }) {
  if (!value) return <span className="text-mute">Not provided</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
      {value} <Badge tone={verified ? 'green' : 'amber'}>{verified ? 'Verified' : 'Unverified'}</Badge>
    </span>
  );
}
