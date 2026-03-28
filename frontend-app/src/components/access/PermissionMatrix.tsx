import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { getPermissionDisplayMeta, groupPermissionsByDisplay } from '@/lib/interfacePermissions';
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
      const meta = getPermissionDisplayMeta(permission);
      const haystack = [
        permission.key,
        permission.description,
        permission.module,
        meta.title,
        meta.groupLabel,
        meta.actionLabel,
        meta.interfaceSummary,
        meta.routeSummary,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [permissions, normalizedSearch]);

  const grouped = useMemo(() => groupPermissionsByDisplay(filteredPermissions), [filteredPermissions]);

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 rounded-md border border-border bg-surface p-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by page, action, description, or permission key"
        />
      </div>
      {grouped.map(({ label, items }) => (
        <section key={label} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">{label}</h4>
            <Badge variant="info">{items.length} permissions</Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {items.map((permission) => {
              const checked = selected.has(permission.key);
              const meta = getPermissionDisplayMeta(permission);
              return (
                <label key={permission.key} className="flex items-start gap-2 rounded-md border border-border/70 p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border border-border"
                    checked={checked}
                    onChange={(event) => onToggle(permission.key, event.target.checked)}
                  />
                  <span>
                    <span className="block font-medium text-foreground">{meta.title}</span>
                    <span className="block text-xs text-muted">{meta.helperText || 'No description'}</span>
                    <span className="mt-1 block text-[11px] text-muted">Permission key: {permission.key}</span>
                    {meta.interfaceSummary ? (
                      <span className="mt-1 block text-[11px] text-primary">
                        Used in: {meta.interfaceSummary}
                        {meta.interfaceCount > 2 ? ` +${meta.interfaceCount - 2} more` : ''}
                        {meta.routeSummary ? ` (${meta.routeSummary})` : ''}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted">
          No permissions matched your search.
        </div>
      ) : null}
    </div>
  );
}
