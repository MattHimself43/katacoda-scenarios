import { useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../lib/auth';
import type { ChangeRequest, SettingsResponse } from '../../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner, Textarea, statusTone, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { ChangeTable } from './ChangeTable';

type Action = { kind: 'approve' | 'reject' | 'cancel'; request: ChangeRequest };

export function RequestsTab({ settings, onDecided }: { settings: SettingsResponse; onDecided: () => void }) {
  const { me, can } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<'PENDING' | ''>('PENDING');
  const list = useApi<{ requests: ChangeRequest[] }>(`/api/settings/change-requests${filter ? `?status=${filter}` : ''}`);
  const [action, setAction] = useState<Action | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = can('settings.approve');

  const open = (a: Action) => {
    setAction(a);
    setNotes('');
    setError(null);
  };

  const confirm = async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      const { request: r, kind } = action;
      if (kind === 'approve') {
        const res = await api.post<{ version: number }>(`/api/settings/change-requests/${r.id}/approve`, { reviewedHash: r.content_hash, notes: notes || null });
        toast('success', `Approved. Configuration version v${res.version} is now active for future research runs.`);
      } else {
        await api.post(`/api/settings/change-requests/${r.id}/${kind}`, { notes: notes || null });
        toast('success', kind === 'reject' ? `Change request #${r.id} rejected.` : `Change request #${r.id} cancelled.`);
      }
      setAction(null);
      await list.reload();
      onDecided();
    } catch (e) {
      setError(errorMessage(e));
      await list.reload();
      onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant={filter === 'PENDING' ? 'primary' : 'secondary'} onClick={() => setFilter('PENDING')}>Pending</Button>
        <Button variant={filter === '' ? 'primary' : 'secondary'} onClick={() => setFilter('')}>All history</Button>
      </div>
      {list.error && <ErrorBanner message={list.error} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.requests.length === 0 && (
        <Card><EmptyState title={filter ? 'No pending change requests' : 'No change requests yet'}>Proposals appear here for administrator review.</EmptyState></Card>
      )}
      {list.data?.requests.map((r) => {
        const mine = r.requested_by === me?.user.id;
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">Change request #{r.id}</p>
                <p className="mt-0.5 text-sm text-mute">
                  Proposed by {r.requested_by_name} · {formatDateTime(r.requested_at)} · based on v{r.base_version}
                </p>
              </div>
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            </div>
            <div className="space-y-3 px-5 py-4">
              {r.is_stale && <ErrorBanner message={`Stale: version v${settings.active.version} is now active. This request can no longer be approved — cancel it and re-propose.`} />}
              <ChangeTable changes={r.changes} />
              {r.reason && <p className="text-sm"><span className="text-mute">Reason: </span>{r.reason}</p>}
              {r.status !== 'PENDING' && (
                <p className="text-sm text-mute">
                  {r.status === 'APPROVED' && `Approved by ${r.decided_by_name} on ${formatDateTime(r.decided_at)} → v${r.resulting_version}`}
                  {r.status === 'REJECTED' && `Rejected by ${r.decided_by_name} on ${formatDateTime(r.decided_at)}`}
                  {r.status === 'CANCELLED' && `Cancelled by ${r.decided_by_name} on ${formatDateTime(r.decided_at)}`}
                  {r.status === 'SUPERSEDED' && `Superseded on ${formatDateTime(r.decided_at)}`}
                  {r.decision_notes && ` — “${r.decision_notes}”`}
                </p>
              )}
            </div>
            {r.status === 'PENDING' && (isAdmin || mine) && (
              <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
                {(mine || isAdmin) && <Button variant="ghost" onClick={() => open({ kind: 'cancel', request: r })}>Cancel request</Button>}
                {isAdmin && <Button variant="danger" onClick={() => open({ kind: 'reject', request: r })}>Reject</Button>}
                {isAdmin && <Button variant="primary" disabled={r.is_stale} onClick={() => open({ kind: 'approve', request: r })}>Approve</Button>}
              </div>
            )}
            {r.status === 'PENDING' && !isAdmin && !mine && (
              <p className="border-t border-line px-5 py-3 text-xs text-mute">Awaiting administrator review.</p>
            )}
          </Card>
        );
      })}

      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action?.kind === 'approve' ? 'Approve configuration change' : action?.kind === 'reject' ? 'Reject change request' : 'Cancel change request'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAction(null)}>Back</Button>
            <Button variant={action?.kind === 'approve' ? 'primary' : 'danger'} loading={busy} onClick={() => void confirm()}>
              {action?.kind === 'approve' ? `Approve and activate v${settings.active.version + 1}` : action?.kind === 'reject' ? 'Reject' : 'Cancel request'}
            </Button>
          </>
        }
      >
        {action && (
          <div className="space-y-4">
            {error && <ErrorBanner message={error} />}
            {action.kind === 'approve' && (
              <p className="text-sm text-mute">
                You are approving exactly these changes (fingerprint <code className="font-mono text-ink">{action.request.content_hash?.slice(0, 12)}</code>).
                Future discovery runs will use the new version; runs already started keep their snapshot. Existing leads,
                conversations and shortlists are unaffected.
              </p>
            )}
            <ChangeTable changes={action.request.changes} />
            <Field label="Notes (optional)" htmlFor="decision-notes">
              <Textarea id="decision-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
