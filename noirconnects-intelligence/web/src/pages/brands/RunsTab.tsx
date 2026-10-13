import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorBanner, Spinner, statusTone } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import type { ImportRecord, ResearchRunSummary } from '../../lib/types';
import { formatDateTime } from '../../lib/format';
import { OUTCOME_LABELS } from '../../lib/brands';

export function RunsTab() {
  const { data, error, loading } = useApi<{ runs: ResearchRunSummary[] }>('/api/research/runs?type=BRAND_DISCOVERY');
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorBanner message={error} />;
  if (loading || !data) return <Spinner />;
  if (!data.runs.length) return <Card><EmptyState title="No research runs yet">Each import — successful or failed — is recorded here with its configuration version.</EmptyState></Card>;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {data.runs.map((r) => (
          <li key={r.id}>
            <button className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-neutral-50" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  Run #{r.id} · {r.input_file_name ?? 'pasted content'}
                </p>
                <p className="text-xs text-mute">
                  {formatDateTime(r.started_at)} · {r.started_by_name ?? 'system'} · {r.niche} v{r.settings_version} · {r.input_format ?? '—'} · {r.source === 'MANUAL_IMPORT' ? 'manual import' : 'scheduled'}
                </p>
              </div>
              <p className="tabular text-xs text-mute">
                {r.records_imported} imported · {r.records_duplicate} duplicate · {r.records_rejected} rejected / {r.records_received}
              </p>
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            </button>
            {open === r.id && <RunDetail run={r} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RunDetail({ run }: { run: ResearchRunSummary }) {
  const { data } = useApi<{ results: ImportRecord[] }>(`/api/research/runs/${run.id}/results`);
  return (
    <div className="space-y-3 px-5 pb-5">
      {run.error_details && run.error_details.length > 0 && <ErrorBanner message={run.error_details.join(' · ')} />}
      {run.warnings.map((w) => <p key={w} className="text-sm text-amber-800">{w}</p>)}
      {data && data.results.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line text-sm">
          {data.results.map((r) => (
            <li key={r.index} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="tabular w-6 text-xs text-mute">{r.index + 1}</span>
              <span className="min-w-0 flex-1 truncate">{r.name ?? '—'} <span className="text-mute">{r.domain ?? ''}</span></span>
              {r.score && <span className="tabular text-xs text-mute">score {r.score.total}</span>}
              <Badge tone={r.imported ? 'green' : statusTone(r.outcome)}>{r.imported ? 'Imported' : OUTCOME_LABELS[r.outcome]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
