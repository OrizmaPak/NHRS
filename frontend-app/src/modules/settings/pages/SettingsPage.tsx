import { Link } from 'react-router-dom';
import { Palette, ShieldCheck, UserRoundCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { StatusBadge } from '@/components/feedback/StatusBadge';

const items = [
  {
    to: '/app/settings/appearance',
    title: 'Appearance settings',
    description: 'Personal display controls: dark mode, font scaling, contrast, and motion preferences.',
    icon: Palette,
    adminOnly: false,
  },
  {
    to: '/app/settings/brand',
    title: 'Brand settings',
    description: 'Manage institutional or government branding assets for the active operational context.',
    icon: UserRoundCog,
    permissions: ['ui.theme.write', 'rbac.org.manage', 'rbac.app.manage'],
    adminOnly: true,
  },
  {
    to: '/app/settings/accessibility',
    title: 'Accessibility controls',
    description: 'Set defaults for font scale, reduced motion, and high contrast mode.',
    icon: ShieldCheck,
    adminOnly: false,
  },
];

export function SettingsPage() {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const _permissionsVersion = usePermissionsStore((state) => state.version);
  void _permissionsVersion;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage personal accessibility preferences and, where authorized, organization-level branding."
        breadcrumbs={[{ label: 'Settings' }]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const allowed = !item.permissions
            ? true
            : Array.isArray(item.permissions)
              ? hasAny(item.permissions)
              : hasPermission(item.permissions);

          const content = (
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/50">
              <div className="mb-2 flex items-start justify-between gap-2">
                <item.icon className="h-5 w-5 text-primary" />
                {item.adminOnly ? <StatusBadge status={allowed ? 'admin' : 'restricted'} /> : null}
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
              {item.permissions && !allowed ? (
                <p className="mt-3 text-xs text-muted">Requires admin permission in the active context.</p>
              ) : null}
            </Card>
          );

          return allowed ? (
            <Link key={item.to} to={item.to}>
              {content}
            </Link>
          ) : (
            <div key={item.to} className="cursor-not-allowed opacity-70">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
