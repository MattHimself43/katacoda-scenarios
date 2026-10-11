import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import type { ConfigChange, IntelligenceConfig, SettingsVersion } from '../../lib/types';
import { Badge, Card, ErrorBanner, Spinner } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { ChangeTable } from './ChangeTable';

function diff(from: IntelligenceConfig, to: IntelligenceConfig): ConfigChange[] {
  return (Object.keys(to) as (keyof IntelligenceConfig)[])
    .filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]))
    .map((k) => ({ key: k, from: from[k], to: to[k] }));
}

export function VersionsTab() {
  const { data, error, loading } = useApi<{ versions: SettingsVersion[] }>('/api/settings/versions');
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorBanner message={error} />;
  if (loading || !data) return <Spinner />;
  return (
    <Card>
      <ul className="divide-y divide-line">
        {data.versions.map((v, i) => {
          const prev = data.versions[i + 1];
          const changes = prev ? diff(prev.config, v.config) : [];
          return (
            <li key={v.id}>
              <button
                onClick={() => setOpen(open === v.id ? null : v.id)}
                aria-expanded={open === v.id}
                className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left hover:bg-neutral-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    v{v.version} {i === 0 && <Badge tone="dark">Active</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-mute">
                    {formatDateTime(v.created_at)}
                    {v.approved_by ? ` · approved by ${v.approved_by}` : ' · initial configuration'}
                    {v.requested_by ? ` · proposed by ${v.requested_by}` : ''}
                    {prev ? ` · ${changes.length} change${changes.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <span className="font-mono text-xs text-mute">{v.config_hash.slice(0, 12)}</span>
              </button>
              {open === v.id && (
                <div className="space-y-3 px-5 pb-5">
                  {v.notes && <p className="text-sm"><span className="text-mute">Notes: </span>{v.notes}</p>}
                  {prev ? <ChangeTable changes={changes} /> : <p className="text-sm text-mute">Initial configuration.</p>}
                  <details className="text-sm">
                    <summary className="cursor-pointer text-mute">Full configuration snapshot</summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-50 p-3 font-mono text-xs">{JSON.stringify(v.config, null, 2)}</pre>
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
