import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Check, Loader2, X, AlertTriangle } from 'lucide-react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'secondary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-ink text-white hover:bg-neutral-800 border border-ink',
    secondary: 'bg-white text-ink border border-line hover:border-neutral-400',
    danger: 'bg-white text-red-700 border border-red-200 hover:border-red-400',
    ghost: 'bg-transparent text-ink hover:bg-neutral-100 border border-transparent',
  };
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 h-9 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap',
        styles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-line bg-white', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-mute">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'dark' | 'amber' | 'green' | 'red' | 'blue';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-neutral-100 text-neutral-700',
    dark: 'bg-ink text-white',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    green: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
    blue: 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200',
  };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

export function statusTone(status: string): Tone {
  if (['PENDING', 'PENDING_BRAND_APPROVAL', 'PENDING_EMAIL_APPROVAL'].includes(status)) return 'amber';
  if (['APPROVED', 'EXECUTED', 'ACTIVE'].includes(status)) return 'green';
  if (['REJECTED', 'DECLINED', 'FAILED'].includes(status)) return 'red';
  return 'neutral';
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-mute">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-white px-3 h-10 text-sm outline-none transition focus:border-ink disabled:bg-neutral-50 disabled:text-mute';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, 'pr-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'h-auto min-h-20 py-2', props.className)} />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-mute" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-line bg-neutral-50 px-4 py-3 text-sm text-neutral-700">{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-mute">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl outline-none sm:max-w-lg sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-mute hover:bg-neutral-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Toasts: explicit feedback after every action
interface Toast { id: number; kind: 'success' | 'error'; message: string }
const ToastCtx = createContext<(kind: Toast['kind'], message: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg',
              t.kind === 'success' ? 'bg-ink text-white' : 'bg-red-700 text-white',
            )}
          >
            {t.kind === 'success' ? <Check className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
