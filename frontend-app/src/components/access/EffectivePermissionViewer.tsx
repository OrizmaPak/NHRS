import { Badge } from '@/components/ui/Badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';

export type EffectivePermissionItem = {
  key: string;
  source: 'role' | 'override_allow' | 'override_deny';
  granted: boolean;
};

export function EffectivePermissionViewer({
  rolePermissions,
  overrides,
  effectivePermissions,
}: {
  rolePermissions: string[];
  overrides: Array<{ key: string; effect: 'allow' | 'deny' }>;
  effectivePermissions: EffectivePermissionItem[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Permissions from Roles</CardTitle>
            <CardDescription>Baseline permissions inherited via assigned roles.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-1">
          {rolePermissions.length === 0 ? <p className="text-sm text-muted">No role permissions.</p> : null}
          {rolePermissions.map((key) => (
            <div key={key} className="flex items-center justify-between rounded border border-border p-2">
              <span className="text-sm text-foreground">{key}</span>
              <Badge variant="info">From Role</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Overrides Applied</CardTitle>
            <CardDescription>Direct user-level allow/deny overrides.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-1">
          {overrides.length === 0 ? <p className="text-sm text-muted">No overrides.</p> : null}
          {overrides.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between rounded border border-border p-2">
              <span className="text-sm text-foreground">{entry.key}</span>
              <Badge variant={entry.effect === 'allow' ? 'success' : 'danger'}>
                {entry.effect === 'allow' ? 'Override Allow' : 'Denied'}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Final Effective Permissions</CardTitle>
            <CardDescription>Resolved permissions after applying overrides.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-1">
          {effectivePermissions.length === 0 ? <p className="text-sm text-muted">No effective permissions calculated.</p> : null}
          {effectivePermissions.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between rounded border border-border p-2">
              <span className="text-sm text-foreground">{entry.key}</span>
              <Badge
                variant={
                  entry.source === 'override_deny'
                    ? 'danger'
                    : entry.source === 'override_allow'
                      ? 'success'
                      : 'info'
                }
              >
                {entry.source === 'override_deny'
                  ? 'Denied'
                  : entry.source === 'override_allow'
                    ? 'From Override'
                    : 'From Role'}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
