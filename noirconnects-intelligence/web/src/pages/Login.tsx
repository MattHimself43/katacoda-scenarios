import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, ErrorBanner, Field, Input } from '../components/ui';

export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-ink px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-semibold tracking-tight text-white">NoirConnects</p>
          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-neutral-500">Intelligence</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
          <h1 className="text-lg font-semibold">Sign in</h1>
          {error && <ErrorBanner message={error} />}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={loading}>
            Sign in
          </Button>
          <p className="text-center text-xs text-mute">Accounts are created by an administrator.</p>
        </form>
      </div>
    </div>
  );
}
