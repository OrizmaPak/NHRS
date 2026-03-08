import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { findInterfacePermissions } from '@/lib/interfacePermissions';
import { useState } from 'react';

export type PermissionOption = {
  key: string;
  module: string;
  description: string;
};

export function PermissionMatrix({
  permissions,
  selected,
  onToggle,
}: {
  permissions: PermissionOption[];
  selected: Set<string>;
  onToggle: (permissionKey: string, checked: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();

  const filteredPermissions = useMemo(() => {
    if (!normalizedSearch) return permissions;
    return permissions.filter((permission) => {
      const interfaces = findInterfacePermissions(permission.key);
      const interfaceText = interfaces.map((entry) => `${entry.interfaceLabel} ${entry.route}`).join(' ');
      const haystack = `${permission.key} ${permission.description} ${permission.module} ${interfaceText}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [permissions, normalizedSearch]);

  const grouped = useMemo(
    () =>
      filteredPermissions.reduce<Record<string, PermissionOption[]>>((acc, permission) => {
        const key = permission.module || 'general';
        if (!acc[key]) acc[key] = [];
        acc[key].push(permission);
        return acc;
      }, {}),
    [filteredPermissions],
  );

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 rounded-md border border-border bg-surface p-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search permission key, description, or interface route"
        />
      </div>
      {Object.entries(grouped).map(([module, entries]) => (
        <section key={module} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">{module}</h4>
            <Badge variant="info">{entries.length} permissions</Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {entries.map((permission) => {
              const checked = selected.has(permission.key);
              const interfaces = findInterfacePermissions(permission.key);
              return (
                <label key={permission.key} className="flex items-start gap-2 rounded-md border border-border/70 p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border border-border"
                    checked={checked}
                    onChange={(event) => onToggle(permission.key, event.target.checked)}
                  />
                  <span>
                    <span className="block font-medium text-foreground">{permission.key}</span>
                    <span className="block text-xs text-muted">{permission.description || 'No description'}</span>
                    {interfaces.length > 0 ? (
                      <span className="mt-1 block text-[11px] text-primary">
                        Interface: {interfaces[0].interfaceLabel} ({interfaces[0].route})
                        {interfaces.length > 1 ? ` +${interfaces.length - 1} more` : ''}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted">
          No permissions matched your search.
        </div>
      ) : null}
    </div>
  );
}
