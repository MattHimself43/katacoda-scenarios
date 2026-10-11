import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { BrandsTab } from './BrandsTab';
import { ImportTab } from './ImportTab';
import { RunsTab } from './RunsTab';

const TABS = [
  { id: 'brands', label: 'Discovered brands' },
  { id: 'import', label: 'Import research', permission: 'research.import' },
  { id: 'runs', label: 'Run history' },
] as const;

export function BrandDiscoveryPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const tabs = TABS.filter((t) => !('permission' in t) || can(t.permission));
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'brands';
  return (
    <>
      <PageHeader
        title="Brand Discovery"
        description="Brands with verifiable influencer marketing activity, imported from validated research. Every brand is reviewed before any outreach is prepared."
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams(t.id === 'brands' ? {} : { tab: t.id })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === t.id ? 'border-ink font-medium text-ink' : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'brands' ? <BrandsTab /> : tab === 'import' ? <ImportTab onImported={() => setParams({ tab: 'runs' })} /> : <RunsTab />}
    </>
  );
}
