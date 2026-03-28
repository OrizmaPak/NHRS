import { NavLink } from 'react-router-dom';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { navigationItems } from '@/routes/navigation';
import { isNavigationItemVisibleInContext } from '@/lib/navigationAccess';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useUIStore } from '@/stores/uiStore';
import { useContextStore } from '@/stores/contextStore';
import { useAuthStore } from '@/stores/authStore';

export function Sidebar() {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const activeContext = useContextStore((state) => state.activeContext);
  const availableContexts = useContextStore((state) => state.availableContexts);
  const user = useAuthStore((state) => state.user);

  const items = useMemo(
    () =>
      navigationItems.filter((item) => {
        if (!isNavigationItemVisibleInContext(item, activeContext)) return false;
        if (!item.permission) return true;
        return Array.isArray(item.permission) ? hasAny(item.permission) : hasPermission(item.permission);
      }),
    [_permissionsVersion, hasAny, hasPermission, activeContext],
  );

  const groupedItems = useMemo(
    () =>
      items.reduce<Record<string, typeof items>>((acc, item) => {
        const key = item.group;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {}),
    [items],
  );

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 h-screen w-72 overflow-y-auto border-r border-border bg-surface p-4 transition-transform lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="mb-6 rounded-lg border border-border/80 bg-surface p-3 shadow-subtle">
        <p className="truncate text-sm font-semibold text-foreground">{activeContext?.name ?? 'Context'}</p>
        <p className="truncate text-xs text-muted">
          {activeContext?.subtitle ?? 'Active Role Context'}
        </p>
        {availableContexts.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {availableContexts.slice(0, 4).map((ctx) => (
              <span
                key={ctx.id}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                  ctx.id === activeContext?.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted',
                )}
              >
                {ctx.name}
              </span>
            ))}
          </div>
        ) : null}
        {Array.isArray(user?.roles) && user.roles.length > 0 ? (
          <p className="mt-2 truncate text-[11px] text-muted">Account: {user.roles.join(', ')}</p>
        ) : null}
      </div>

      <nav className="space-y-4">
        {Object.entries(groupedItems).map(([group, groupEntries]) => (
          <section key={group} className="space-y-1">
            <h3 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{group}</h3>
            {groupEntries.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/app'}
                onClick={() => {
                  if (sidebarOpen) setSidebarOpen(false);
                }}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary text-primary-foreground' : 'text-muted hover:bg-muted/10 hover:text-foreground',
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </section>
        ))}
      </nav>
    </aside>
  );
}
