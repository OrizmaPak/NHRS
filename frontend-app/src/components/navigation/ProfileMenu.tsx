import { LogOut, Settings, UserCircle2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';

export function ProfileMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.fullName || 'Profile';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" className="h-10 gap-2 px-2 text-left">
          <UserCircle2 className="h-5 w-5" />
          <span className="hidden text-sm font-medium md:inline-block">{displayName}</span>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 w-60 rounded-lg border border-border bg-surface p-1 shadow-soft">
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-foreground">{displayName}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => navigate('/app/settings')}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground outline-none focus:bg-primary/10"
          >
            <Settings className="h-4 w-4" />
            Settings
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={async () => {
              await logout();
              navigate('/auth/login');
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-danger outline-none focus:bg-danger/10"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
