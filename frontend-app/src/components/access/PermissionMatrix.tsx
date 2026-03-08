import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';

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
  const grouped = useMemo(
    () =>
      permissions.reduce<Record<string, PermissionOption[]>>((acc, permission) => {
        const key = permission.module || 'general';
        if (!acc[key]) acc[key] = [];
        acc[key].push(permission);
        return acc;
      }, {}),
    [permissions],
  );

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([module, entries]) => (
        <section key={module} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">{module}</h4>
            <Badge variant="info">{entries.length} permissions</Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {entries.map((permission) => {
              const checked = selected.has(permission.key);
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
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
