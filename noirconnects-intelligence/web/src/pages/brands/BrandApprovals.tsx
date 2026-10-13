import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, statusTone } from '../../components/ui';
import { ScorePill } from '../../components/brands/ScoreBreakdown';
import { BrandDecisionModal } from '../../components/brands/BrandDecisionModal';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../lib/auth';
import type { BrandSummary } from '../../lib/types';
import { brandStatusLabel, safeHref } from '../../lib/brands';
import { formatDateTime } from '../../lib/format';

const VIEWS = [
  { id: 'PENDING_BRAND_APPROVAL', label: 'Pending', sort: 'score' },
  { id: 'APPROVED_FOR_OUTREACH', label: 'Approved', sort: 'recent' },
  { id: 'DECLINED', label: 'Declined', sort: 'recent' },
] as const;

export function BrandApprovalsPage() {
  const { can } = useAuth();
  const [view, setView] = useState<(typeof VIEWS)[number]>(VIEWS[0]);
  const { data, error, loading, reload } = useApi<{ total: number; brands: BrandSummary[] }>(`/api/brands?status=${view.id}&sort=${view.sort}&limit=100`);
  const [decision, setDecision] = useState<{ id: number; kind: 'approve' | 'decline' } | null>(null);
  const canDecide = can('brands.decide');

  return (
    <>
      <PageHeader
        title="Brand Approvals"
        description="Approve or decline each discovered brand. Approval authorizes preparing an outreach draft only — never sending an email."
      />
      <div className="mb-4 flex gap-2">
        {VIEWS.map((v) => (
          <Button key={v.id} variant={view.id === v.id ? 'primary' : 'secondary'} onClick={() => setView(v)}>
            {v.label}
            {view.id === v.id && data ? ` (${data.total})` : ''}
          </Button>
        ))}
      </div>
      {!canDecide && view.id === 'PENDING_BRAND_APPROVAL' && (
        <p className="mb-4 text-sm text-mute">Your role can review this queue but cannot approve or decline brands.</p>
      )}
      {error && <ErrorBanner message={error} />}
      {loading && !data && <Spinner />}
      {data && data.brands.length === 0 && (
        <Card>
          <EmptyState title={view.id === 'PENDING_BRAND_APPROVAL' ? 'No brands awaiting approval' : 'Nothing here yet'}>
            {view.id === 'PENDING_BRAND_APPROVAL' && (
              <>New brands arrive from <Link className="underline" to="/brand-discovery?tab=import">research imports</Link>.</>
            )}
          </EmptyState>
        </Card>
      )}
      <div className="space-y-3">
        {data?.brands.map((b) => (
          <Card key={b.id}>
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
              <div className="self-start"><ScorePill score={b.quality_score} /></div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/brands/${b.id}`} className="text-[15px] font-semibold hover:underline">{b.name}</Link>
                  <Badge tone={statusTone(b.status)}>{brandStatusLabel(b.status)}</Badge>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-mute">
                  {safeHref(b.website_url) ? (
                    <a href={safeHref(b.website_url)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-ink">
                      {b.website_domain} <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : b.website_domain}
                  <span>· {b.subcategory ?? b.industry ?? '—'}</span>
                  <span>· {b.discovery_niche} v{b.settings_version}</span>
                  <span>· found {formatDateTime(b.created_at)}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {b.partnership_evidence > 0 ? (
                    <Badge>{b.partnership_evidence} partnership evidence</Badge>
                  ) : (
                    <Badge tone="amber">No paid partnership evidence</Badge>
                  )}
                  {b.affiliate_evidence > 0 && <Badge>{b.affiliate_evidence} affiliate</Badge>}
                  <Badge>{b.verified_evidence}/{b.total_evidence} verified</Badge>
                  {b.contact_email ? (
                    <Badge tone={b.contact_email_verified ? 'green' : 'amber'}>{b.contact_email_verified ? 'Verified email' : 'Unverified email'}</Badge>
                  ) : b.contact_channel_url ? (
                    <Badge>Contact page only</Badge>
                  ) : (
                    <Badge tone="amber">No contact route</Badge>
                  )}
                </div>
                {b.warnings.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-amber-800">
                    {b.warnings.map((w) => <li key={w}>! {w}</li>)}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
                <Link to={`/brands/${b.id}`} className="inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-sm font-medium hover:bg-neutral-100">
                  Evidence
                </Link>
                {canDecide && b.status === 'PENDING_BRAND_APPROVAL' && (
                  <>
                    <Button variant="danger" onClick={() => setDecision({ id: b.id, kind: 'decline' })}>Decline</Button>
                    <Button variant="primary" onClick={() => setDecision({ id: b.id, kind: 'approve' })}>Approve</Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <BrandDecisionModal
        brandId={decision?.id ?? null}
        kind={decision?.kind ?? 'approve'}
        onClose={() => setDecision(null)}
        onDone={() => { setDecision(null); void reload(); }}
      />
    </>
  );
}
