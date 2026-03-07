import { Link } from 'react-router-dom';
import { Palette, ShieldCheck, UserRoundCog } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';

const items = [
  {
    to: '/app/settings/appearance',
    title: 'Appearance settings',
    description: 'Theme tokens, contrast defaults, and logo behavior by context.',
    icon: Palette,
  },
  {
    to: '/app/settings/brand',
    title: 'Brand settings',
    description: 'Manage institutional branding assets, logos, and typographic feel.',
    icon: UserRoundCog,
  },
  {
    to: '/app/settings/accessibility',
    title: 'Accessibility controls',
    description: 'Set defaults for font scale, reduced motion, and high contrast mode.',
    icon: ShieldCheck,
  },
];

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Control brand, accessibility, and user experience defaults for each operational context."
        breadcrumbs={[{ label: 'Settings' }]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link key={item.to} to={item.to}>
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-primary/50">
              <item.icon className="mb-4 h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-semibold text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
