import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { CollapsiblePermissionSection } from '@/components/access/CollapsiblePermissionSection';
import { getPermissionDisplayMeta, groupPermissionsByDisplay } from '@/lib/interfacePermissions';

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
        (() => {
          const activeCount = items.filter((permission) => selected.has(permission.key)).length;
          const allSelected = items.length > 0 && activeCount === items.length;

          return (
            <CollapsiblePermissionSection
              key={label}
              title={label}
              totalCount={items.length}
              activeCount={activeCount}
              headerAction={(
                <div className="flex items-center gap-2 rounded-full border border-border/70 bg-surface px-2 py-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Select all</span>
                  <Switch
                    checked={allSelected}
                    onCheckedChange={(nextChecked) => {
                      for (const permission of items) {
                        onToggle(permission.key, nextChecked);
                      }
                    }}
                    aria-label={`${allSelected ? 'Clear' : 'Select'} all ${label} permissions`}
                  />
                </div>
              )}
            >
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {items.map((permission) => {
                  const checked = selected.has(permission.key);
                  const meta = getPermissionDisplayMeta(permission);
                  return (
                    <div
                      key={permission.key}
                      className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-surface/70 p-3 text-sm transition-colors hover:border-border hover:bg-muted/10"
                    >
                      <span className="min-w-0 flex-1">
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
                      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                        <Switch
                          checked={checked}
                          onCheckedChange={(nextChecked) => onToggle(permission.key, nextChecked)}
                          aria-label={`${checked ? 'Disable' : 'Enable'} ${meta.title}`}
                        />
                        <span className={`text-[11px] font-medium ${checked ? 'text-emerald-700' : 'text-muted'}`}>
                          {checked ? 'On' : 'Off'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsiblePermissionSection>
          );
        })()
      ))}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-sm text-muted">
          No permissions matched your search.
        </div>
      ) : null}
    </div>
  );
}
