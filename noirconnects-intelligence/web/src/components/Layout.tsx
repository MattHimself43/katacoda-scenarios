import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Search, X } from 'lucide-react';
import { NAV } from '../lib/nav';
import { useAuth } from '../lib/auth';

const COLLAPSE_KEY = 'nc.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const { me, logout, can } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const items = NAV.filter((n) => !n.permission || can(n.permission));

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const sidebar = (isMobile: boolean) => (
    <nav className="flex h-full flex-col bg-ink text-neutral-300" aria-label="Main">
      <div className="flex h-16 items-center justify-between px-4">
        {(!collapsed || isMobile) && (
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight text-white">NoirConnects</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Intelligence</p>
          </div>
        )}
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Close menu">
            <X className="size-5" />
          </button>
        ) : (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 hover:bg-white/10"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </button>
        )}
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {items.map((item) => {
          const Icon = item.icon;
          const showLabel = !collapsed || isMobile;
          return (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                title={showLabel ? undefined : item.label}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                    isActive ? 'bg-white text-ink font-medium' : 'hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="size-[18px] shrink-0" aria-hidden />
                {showLabel && <span className="flex-1 truncate">{item.label}</span>}
                {showLabel && item.phase && (
                  <span className="rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-neutral-500 ring-1 ring-inset ring-neutral-700">
                    P{item.phase}
                  </span>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
      {me && (
        <div className="border-t border-white/10 p-3">
          {(!collapsed || isMobile) && (
            <div className="mb-2 px-1">
              <p className="truncate text-sm text-white">{me.user.displayName}</p>
              <p className="truncate text-xs text-neutral-500">
                {me.user.role}
                {me.user.isOwner ? ' · Owner' : ''}
              </p>
            </div>
          )}
          <button
            onClick={() => void logout()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] hover:bg-white/10 hover:text-white"
            title="Sign out"
          >
            <LogOut className="size-[18px]" aria-hidden />
            {(!collapsed || isMobile) && 'Sign out'}
          </button>
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className={`hidden shrink-0 transition-[width] duration-200 lg:block ${collapsed ? 'w-[68px]' : 'w-64'}`}>
        <div className="fixed inset-y-0 left-0" style={{ width: collapsed ? 68 : 256 }}>
          {sidebar(false)}
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar(true)}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 hover:bg-neutral-100 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <form onSubmit={onSearch} className="relative w-full max-w-md" role="search">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-mute" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search brands and creators"
              aria-label="Global search"
              className="h-10 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-ink"
            />
          </form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
