import { Link } from 'react-router-dom';
import { Palette, Settings2, ShieldCheck, UserRound, UserRoundCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { usePermissionsStore } from '@/stores/permissionsStore';
import { useContextStore } from '@/stores/contextStore';
import { StatusBadge } from '@/components/feedback/StatusBadge';

const items = [
  {
    to: '/app/settings/my-profile',
    title: 'My profile',
    description: 'View your profile details, your current context, and every context available to your account.',
    icon: UserRound,
    adminOnly: false,
  },
  {
    to: '/app/settings/appearance',
    title: 'Appearance settings',
    description: 'Personal display controls: dark mode, font scaling, contrast, and motion preferences.',
    icon: Palette,
    adminOnly: false,
    contexts: ['platform'],
  },
  {
    to: '/app/settings/brand',
    title: 'Brand settings',
    description: 'Manage organization branding assets for the active organization context.',
    icon: UserRoundCog,
    permissions: ['ui.theme.write', 'rbac.org.manage', 'rbac.app.manage'],
    adminOnly: true,
    contexts: ['organization'],
  },
  {
    to: '/app/settings/accessibility',
    title: 'Accessibility controls',
    description: 'Set accessibility defaults for the active app or organization context.',
    icon: ShieldCheck,
    adminOnly: false,
    contexts: ['platform', 'organization'],
  },
  {
    to: '/app/settings/users',
    title: 'Profile management',
    description: 'Search for a person and complete profile details that are still missing.',
    icon: Settings2,
    permissions: ['profile.user.update'],
    adminOnly: true,
    contexts: ['platform', 'organization'],
  },
  {
    to: '/app/settings/global-services',
    title: 'Global services',
    description: 'Manage the shared service catalog used by institution and branch additional-service fields.',
    icon: Settings2,
    permissions: ['global.services.manage', 'global.services.create', 'global.services.update', 'global.services.delete'],
    adminOnly: true,
    contexts: ['platform', 'organization'],
  },
];

export function SettingsPage() {
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const hasAny = usePermissionsStore((state) => state.hasAny);
  const activeContext = useContextStore((state) => state.activeContext);
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
          const contextAllowed = !item.contexts || (activeContext ? item.contexts.includes(activeContext.type) : false);
          const permissionAllowed = !item.permissions
            ? true
            : Array.isArray(item.permissions)
              ? hasAny(item.permissions)
              : hasPermission(item.permissions);
          const allowed = contextAllowed && permissionAllowed;

          const content = (
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/50">
              <div className="mb-2 flex items-start justify-between gap-2">
                <item.icon className="h-5 w-5 text-primary" />
                {item.adminOnly ? <StatusBadge status={allowed ? 'admin' : 'restricted'} /> : null}
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
              {!contextAllowed ? (
                <p className="mt-3 text-xs text-muted">Unavailable in the current context.</p>
              ) : item.permissions && !permissionAllowed ? (
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
