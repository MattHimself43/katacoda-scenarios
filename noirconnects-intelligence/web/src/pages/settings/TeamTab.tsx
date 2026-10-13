import { useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../lib/auth';
import type { Role, UserRecord } from '../../lib/types';
import { Badge, Button, Card, CardHeader, ErrorBanner, Field, Input, Modal, Select, Spinner, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const ROLES: Role[] = ['ADMIN', 'MANAGER', 'RESEARCHER', 'VIEWER'];
const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Approves settings, external emails, proposals, follow-up policy and integrations.',
  MANAGER: 'Manages pipeline work and decides brand approvals. Cannot authorize external communication.',
  RESEARCHER: 'Imports research, recommends leads and proposes settings changes.',
  VIEWER: 'Read-only.',
};

type Pending =
  | { kind: 'role'; user: UserRecord; role: Role }
  | { kind: 'active'; user: UserRecord; active: boolean }
  | { kind: 'password'; user: UserRecord }
  | { kind: 'create' };

export function TeamTab() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ users: UserRecord[] }>('/api/users');
  const [pending, setPending] = useState<Pending | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'RESEARCHER' as Role, password: '' });
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const manage = can('users.manage');

  const start = (p: Pending) => {
    setPending(p);
    setModalError(null);
    setForm({ email: '', displayName: '', role: 'RESEARCHER', password: '' });
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setModalError(null);
    try {
      if (pending.kind === 'role') {
        await api.patch(`/api/users/${pending.user.id}`, { role: pending.role });
        toast('success', `${pending.user.display_name} is now ${pending.role}. Their sessions were signed out.`);
      } else if (pending.kind === 'active') {
        await api.patch(`/api/users/${pending.user.id}`, { isActive: pending.active });
        toast('success', `${pending.user.display_name} ${pending.active ? 'reactivated' : 'deactivated'}.`);
      } else if (pending.kind === 'password') {
        await api.post(`/api/users/${pending.user.id}/password`, { password: form.password });
        toast('success', `Password reset for ${pending.user.display_name}. Their sessions were signed out.`);
      } else {
        await api.post('/api/users', form);
        toast('success', `User ${form.email} created.`);
      }
      setPending(null);
      await reload();
    } catch (e) {
      setModalError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner message={error} />;
  if (loading || !data) return <Spinner />;

  return (
    <Card>
      <CardHeader
        title="Team & access"
        description="Page access never implies authority — every action is checked against the user’s role on the server."
        actions={manage ? <Button variant="primary" onClick={() => start({ kind: 'create' })}>Add user</Button> : undefined}
      />
      <ul className="divide-y divide-line">
        {data.users.map((u) => (
          <li key={u.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {u.display_name}
                {u.is_owner === 1 && <Badge tone="dark">Owner</Badge>}
                {u.is_active === 0 && <Badge tone="red">Deactivated</Badge>}
                {u.id === me?.user.id && <Badge>You</Badge>}
              </p>
              <p className="truncate text-xs text-mute">{u.email} · last sign-in {formatDateTime(u.last_login_at)}</p>
            </div>
            {manage ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-36">
                  <Select
                    aria-label={`Role for ${u.display_name}`}
                    className="h-9"
                    value={u.role}
                    disabled={u.is_owner === 1}
                    onChange={(e) => start({ kind: 'role', user: u, role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </Select>
                </div>
                {(u.is_owner !== 1 || u.id === me?.user.id) && (
                  <Button onClick={() => start({ kind: 'password', user: u })}>Reset password</Button>
                )}
                {u.is_owner !== 1 && (
                  <Button variant={u.is_active ? 'danger' : 'secondary'} onClick={() => start({ kind: 'active', user: u, active: !u.is_active })}>
                    {u.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                )}
              </div>
            ) : (
              <Badge>{u.role}</Badge>
            )}
          </li>
        ))}
      </ul>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title={
          pending?.kind === 'create' ? 'Add user' : pending?.kind === 'role' ? 'Change role' : pending?.kind === 'password' ? 'Reset password' : pending?.kind === 'active' && pending.active ? 'Reactivate user' : 'Deactivate user'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void confirm()}>Confirm</Button>
          </>
        }
      >
        <div className="space-y-4">
          {modalError && <ErrorBanner message={modalError} />}
          {pending?.kind === 'role' && (
            <p className="text-sm">
              Change <strong>{pending.user.display_name}</strong> from {pending.user.role} to <strong>{pending.role}</strong>? {ROLE_HELP[pending.role]} Their current sessions will be signed out.
            </p>
          )}
          {pending?.kind === 'active' && (
            <p className="text-sm">
              {pending.active ? 'Reactivate' : 'Deactivate'} <strong>{pending.user.display_name}</strong>?{' '}
              {!pending.active && 'They will be signed out immediately and unable to sign in.'}
            </p>
          )}
          {(pending?.kind === 'password' || pending?.kind === 'create') && (
            <>
              {pending.kind === 'create' && (
                <>
                  <Field label="Email" htmlFor="u-email"><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
                  <Field label="Display name" htmlFor="u-name"><Input id="u-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
                  <Field label="Role" htmlFor="u-role" hint={ROLE_HELP[form.role]}>
                    <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </Select>
                  </Field>
                </>
              )}
              <Field label={pending.kind === 'create' ? 'Initial password' : 'New password'} htmlFor="u-pw" hint="At least 12 characters. Share it securely.">
                <Input id="u-pw" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </Modal>
    </Card>
  );
}
