import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SmartSelect } from '@/components/data/SmartSelect';
import { EffectivePermissionViewer } from '@/components/access/EffectivePermissionViewer';
import { ErrorState } from '@/components/feedback/ErrorState';
import { useAppRoles, useAssignUserRole, useDeleteUserOverride, useRemoveUserRole, useUpsertUserOverride, useUserAccess } from '@/api/hooks/useAccessControl';
import { useAuthStore } from '@/stores/authStore';

export function AppUserAccessPage() {
  const { userId = '' } = useParams();
  const authUser = useAuthStore((state) => state.user);
  const resolvedUserId = userId === 'self' ? String(authUser?.id ?? '') : userId;
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overridePermission, setOverridePermission] = useState('');
  const [overrideEffect, setOverrideEffect] = useState<'allow' | 'deny'>('allow');

  const rolesQuery = useAppRoles();
  const userAccessQuery = useUserAccess(resolvedUserId);
  const assignRole = useAssignUserRole('app');
  const removeRole = useRemoveUserRole('app');
  const upsertOverride = useUpsertUserOverride('app');
  const deleteOverride = useDeleteUserOverride('app');

  const roleOptions = useMemo(
    () => (rolesQuery.data ?? []).map((role) => ({ value: role.id, label: role.name })),
    [rolesQuery.data],
  );

  const currentRolePermissions = useMemo(() => {
    const roleMap = new Map((rolesQuery.data ?? []).map((role) => [role.name, role.permissions] as const));
    return Array.from(new Set((userAccessQuery.data?.roles ?? []).flatMap((role) => roleMap.get(role) ?? [])));
  }, [rolesQuery.data, userAccessQuery.data?.roles]);
  const roleIdByName = useMemo(() => new Map((rolesQuery.data ?? []).map((entry) => [entry.name, entry.id] as const)), [rolesQuery.data]);

  if (userId === 'self' && !authUser?.id) {
    return <ErrorState title="Loading user context" description="Fetching your account context..." />;
  }

  if (!resolvedUserId) {
    return <ErrorState title="User context unavailable" description="Please reload profile and retry." />;
  }

  if (userAccessQuery.isError) {
    return <ErrorState title="Unable to load user access" description="Please retry." onRetry={() => userAccessQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Access - App Scope"
        description="Assign global roles, manage direct permission overrides, and inspect effective access."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Access Control' }, { label: 'User Access' }]}
      />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>User Information</CardTitle>
            <CardDescription>User ID: {userAccessQuery.data?.userId ?? resolvedUserId}</CardDescription>
          </div>
        </CardHeader>
        <p className="text-sm text-foreground">Name: {userAccessQuery.data?.userName ?? 'Loading...'}</p>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Assigned Roles</CardTitle>
            <CardDescription>Roles grant baseline app-level permissions.</CardDescription>
          </div>
        </CardHeader>
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="w-full md:max-w-sm">
            <SmartSelect
              value={selectedRoleId}
              onChange={setSelectedRoleId}
              placeholder="Select role to assign"
              loadOptions={async (input) =>
                roleOptions.filter((entry) => entry.label.toLowerCase().includes(input.toLowerCase()))
              }
            />
          </div>
          <Button
            onClick={async () => {
              if (!selectedRoleId) return;
              await assignRole.mutateAsync({ userId: resolvedUserId, roleId: selectedRoleId });
              toast.success('Role assigned');
              setSelectedRoleId(null);
            }}
          >
            Assign Role
          </Button>
        </div>
        <div className="space-y-2">
          {(userAccessQuery.data?.roles ?? []).map((role, index) => (
            <div key={role} className="flex items-center justify-between rounded border border-border p-2">
              <span className="text-sm text-foreground">{role}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const roleId = userAccessQuery.data?.roleIds[index] ?? roleIdByName.get(role);
                  if (!roleId) return;
                  await removeRole.mutateAsync({ userId: resolvedUserId, roleId });
                  toast.success('Role removed');
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Permission Overrides</CardTitle>
            <CardDescription>Allow or deny permissions directly. Overrides take precedence over role permissions.</CardDescription>
          </div>
        </CardHeader>
        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <Input value={overridePermission} onChange={(event) => setOverridePermission(event.target.value)} placeholder="records.delete" />
          <select
            value={overrideEffect}
            onChange={(event) => setOverrideEffect(event.target.value === 'deny' ? 'deny' : 'allow')}
            className="h-10 rounded-md border border-border bg-white px-3 text-sm text-foreground"
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
          <Button
            onClick={async () => {
              if (!overridePermission.trim()) return;
              await upsertOverride.mutateAsync({ userId: resolvedUserId, permissionKey: overridePermission.trim(), effect: overrideEffect });
              toast.success('Override applied');
              setOverridePermission('');
            }}
          >
            Add Override
          </Button>
        </div>
        <div className="space-y-2">
          {(userAccessQuery.data?.overrides ?? []).map((override) => (
            <div key={override.key} className="flex items-center justify-between rounded border border-border p-2">
              <span className="text-sm text-foreground">
                {override.key} ({override.effect})
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await deleteOverride.mutateAsync({ userId: resolvedUserId, permissionKey: override.key });
                  toast.success('Override removed');
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <EffectivePermissionViewer
        rolePermissions={currentRolePermissions}
        overrides={userAccessQuery.data?.overrides ?? []}
        effectivePermissions={userAccessQuery.data?.effectivePermissions ?? []}
      />
    </div>
  );
}
