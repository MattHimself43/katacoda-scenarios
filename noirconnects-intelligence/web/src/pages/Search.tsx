import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, CardHeader, EmptyState, ErrorBanner, PageHeader, Spinner, statusTone } from '../components/ui';
import { brandStatusLabel } from '../lib/brands';
import { useApi } from '../lib/useApi';

interface Results {
  query: string;
  brands: { id: number; name: string; website_domain: string; status: string; discovery_niche: string }[];
  creators: { id: number; display_name: string; handle: string; platform: string; niche: string | null }[];
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { data, error, loading } = useApi<Results>(`/api/search?q=${encodeURIComponent(q)}`);
  return (
    <>
      <PageHeader title="Search" description={`Results for “${q}”. Declined and dormant records remain searchable.`} />
      {error && <ErrorBanner message={error} />}
      {loading && <Spinner />}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title={`Brands (${data.brands.length})`} />
            {data.brands.length === 0 ? (
              <EmptyState title="No matching brands" />
            ) : (
              <ul className="divide-y divide-line">
                {data.brands.map((b) => (
                  <li key={b.id}>
                    <Link to={`/brands/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-neutral-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.name}</p>
                      <p className="truncate text-xs text-mute">{b.website_domain} · {b.discovery_niche}</p>
                    </div>
                    <Badge tone={statusTone(b.status)}>{brandStatusLabel(b.status)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={`Creators (${data.creators.length})`} />
            {data.creators.length === 0 ? (
              <EmptyState title="No matching creators" />
            ) : (
              <ul className="divide-y divide-line">
                {data.creators.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <p className="font-medium">{c.display_name}</p>
                    <p className="text-xs text-mute">@{c.handle} · {c.platform}{c.niche ? ` · ${c.niche}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
