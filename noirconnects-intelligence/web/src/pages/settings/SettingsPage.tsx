import { useSearchParams } from 'react-router-dom';
import { ErrorBanner, PageHeader, Spinner } from '../../components/ui';
import { useApi } from '../../lib/useApi';
import { useAuth } from '../../lib/auth';
import type { SettingsResponse } from '../../lib/types';
import { ConfigurationTab } from './ConfigurationTab';
import { RequestsTab } from './RequestsTab';
import { VersionsTab } from './VersionsTab';
import { TeamTab } from './TeamTab';

const TABS = [
  { id: 'configuration', label: 'Configuration' },
  { id: 'requests', label: 'Change requests' },
  { id: 'versions', label: 'Version history' },
  { id: 'team', label: 'Team & access', permission: 'users.view' },
] as const;

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const settings = useApi<SettingsResponse>('/api/settings');
  const tabs = TABS.filter((t) => !('permission' in t) || can(t.permission));
  const tab = tabs.find((t) => t.id === params.get('tab'))?.id ?? 'configuration';
  const go = (id: string) => setParams(id === 'configuration' ? {} : { tab: id });

  return (
    <>
      <PageHeader
        title="Intelligence Settings"
        description="Every change is proposed, reviewed and explicitly approved by an administrator before it takes effect. Viewing or editing this page never counts as approval."
      />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === t.id ? 'border-ink font-medium text-ink' : 'border-transparent text-mute hover:text-ink'
            }`}
          >
            {t.label}
            {t.id === 'requests' && settings.data && settings.data.pendingCount > 0 && (
              <span className="ml-1.5 rounded-full bg-ink px-1.5 py-px text-[11px] text-white">{settings.data.pendingCount}</span>
            )}
          </button>
        ))}
      </div>
      {settings.error && <ErrorBanner message={settings.error} />}
      {!settings.data ? (
        settings.loading && <Spinner />
      ) : tab === 'configuration' ? (
        <ConfigurationTab settings={settings.data} onSubmitted={() => { void settings.reload(); go('requests'); }} />
      ) : tab === 'requests' ? (
        <RequestsTab settings={settings.data} onDecided={() => void settings.reload()} />
      ) : tab === 'versions' ? (
        <VersionsTab />
      ) : (
        <TeamTab />
      )}
    </>
  );
}
