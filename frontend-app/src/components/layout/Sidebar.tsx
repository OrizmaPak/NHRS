import { NavLink } from 'react-router-dom';
import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { navigationItems } from '@/routes/navigation';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useUIStore } from '@/stores/uiStore';

export function Sidebar() {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const items = useMemo(
    () => navigationItems.filter((item) => !item.permission || hasPermission(item.permission)),
    [hasPermission],
  );

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 w-72 border-r border-border bg-surface p-4 transition-transform lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className="mb-6 rounded-lg border border-border/80 bg-surface p-3 shadow-subtle">
        <p className="truncate text-sm font-semibold text-foreground">NHRS Public</p>
        <p className="truncate text-xs text-muted">National Health Repository System</p>
      </div>

      <nav className="space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/app'}
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
      </nav>
    </aside>
  );
}
