import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useApi } from '../lib/useApi';
import type { AuditEntry } from '../lib/types';
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';

const PAGE = 50;

export function AuditPage() {
  const actions = useApi<{ actions: string[] }>('/api/audit/actions');
  const [filters, setFilters] = useState({ action: '', q: '' });
  const [draftQ, setDraftQ] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(
    async (beforeId?: number) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ limit: String(PAGE) });
        if (filters.action) qs.set('action', filters.action);
        if (filters.q) qs.set('q', filters.q);
        if (beforeId) qs.set('beforeId', String(beforeId));
        const res = await api.get<{ entries: AuditEntry[] }>(`/api/audit?${qs}`);
        setEntries((prev) => (beforeId ? [...prev, ...res.entries] : res.entries));
        setHasMore(res.entries.length === PAGE);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilters((f) => ({ ...f, q: draftQ.trim() }));
  };

  return (
    <>
      <PageHeader title="Activity & Audit Logs" description="Append-only record of every material decision and system action. Entries cannot be edited or deleted." />
      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row">
          <Select aria-label="Filter by action" value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} className="sm:max-w-xs">
            <option value="">All actions</option>
            {actions.data?.actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
          <Input placeholder="Search action or details" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} aria-label="Search audit log" />
          <Button type="submit">Search</Button>
        </form>
        {error && <div className="p-4"><ErrorBanner message={error} /></div>}
        {loading && entries.length === 0 ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <EmptyState title="No entries match these filters" />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  className="grid w-full grid-cols-1 gap-1 px-5 py-3 text-left text-sm hover:bg-neutral-50 sm:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)] sm:gap-4"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  aria-expanded={expanded === e.id}
                >
                  <span className="tabular text-xs text-mute sm:text-sm">{formatDateTime(e.occurred_at)}</span>
                  <span className="font-mono text-[12.5px] font-medium">{e.action}</span>
                  <span className="truncate text-mute">
                    {e.actor_type === 'USER' ? (e.actor_name ?? `User #${e.actor_user_id}`) : e.actor_type.toLowerCase()}
                    {e.entity_type ? ` · ${e.entity_type}${e.entity_id ? ` #${e.entity_id.slice(0, 8)}` : ''}` : ''}
                  </span>
                </button>
                {expanded === e.id && (
                  <pre className="mx-5 mb-3 overflow-x-auto rounded-lg bg-neutral-50 p-3 font-mono text-xs leading-relaxed">
                    {JSON.stringify({ actor: e.actor_email ?? e.actor_type, ip: e.ip, entity: e.entity_type ? `${e.entity_type}:${e.entity_id}` : null, details: e.details }, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div className="border-t border-line p-3 text-center">
            <Button loading={loading} onClick={() => void load(entries.at(-1)?.id)}>Load older entries</Button>
          </div>
        )}
      </Card>
    </>
  );
}
