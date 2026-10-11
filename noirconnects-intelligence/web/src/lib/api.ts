export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'NoirConnects',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (res.status === 401) window.dispatchEvent(new Event('nc:unauthorized'));
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = Array.isArray(e.details)
      ? (e.details as { path?: string; message?: string }[])
          .map((d) => (d.path ? `${d.path}: ${d.message}` : d.message))
          .filter(Boolean)
          .join('; ')
      : '';
    return details ? `${e.message} — ${details}` : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
