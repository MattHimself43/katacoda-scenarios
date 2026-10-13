import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Select, Spinner, statusTone } from '../../components/ui';
import { ScorePill } from '../../components/brands/ScoreBreakdown';
import { useApi } from '../../lib/useApi';
import type { BrandSummary } from '../../lib/types';
import { BRAND_STATUS_LABELS, brandStatusLabel } from '../../lib/brands';
import { formatDateTime } from '../../lib/format';

const PAGE = 25;

export function BrandsTab() {
  const [filters, setFilters] = useState({ q: '', status: '', niche: '', sort: 'recent' });
  const [draft, setDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const qs = new URLSearchParams({ ...filters, limit: String(PAGE), offset: String(offset) });
  const { data, error, loading } = useApi<{ total: number; brands: BrandSummary[] }>(`/api/brands?${qs}`);
  const niches = useApi<{ niches: string[] }>('/api/brands/niches');

  const update = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setOffset(0);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    update({ q: draft.trim() });
  };

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-3 border-b border-line p-4 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <Input placeholder="Search name or domain" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Search brands" />
        <Select aria-label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(BRAND_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select aria-label="Niche" value={filters.niche} onChange={(e) => update({ niche: e.target.value })}>
          <option value="">All niches</option>
          {niches.data?.niches.map((n) => <option key={n}>{n}</option>)}
        </Select>
        <Select aria-label="Sort" value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
          <option value="recent">Newest first</option>
          <option value="score">Highest score</option>
          <option value="name">Name</option>
        </Select>
        <Button type="submit">Search</Button>
      </form>
      {error && <div className="p-4"><ErrorBanner message={error} /></div>}
      {loading && !data ? (
        <Spinner />
      ) : data && data.brands.length === 0 ? (
        <EmptyState title="No brands found">Import research from the “Import research” tab to discover brands.</EmptyState>
      ) : (
        data && (
          <>
            <ul className="divide-y divide-line">
              {data.brands.map((b) => (
                <li key={b.id}>
                  <Link to={`/brands/${b.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-neutral-50">
                    <ScorePill score={b.quality_score} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.name}</p>
                      <p className="truncate text-xs text-mute">
                        {b.website_domain} · {b.subcategory ?? b.industry ?? '—'} · {b.discovery_niche} v{b.settings_version} · {formatDateTime(b.created_at)}
                      </p>
                    </div>
                    <div className="hidden shrink-0 gap-1.5 sm:flex">
                      {b.partnership_evidence > 0 ? <Badge>Partnership evidence</Badge> : <Badge tone="amber">Affiliate/other only</Badge>}
                    </div>
                    <Badge tone={statusTone(b.status)}>{brandStatusLabel(b.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-mute">
              <span>
                {offset + 1}–{offset + data.brands.length} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
                <Button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
              </div>
            </div>
          </>
        )
      )}
    </Card>
  );
}
