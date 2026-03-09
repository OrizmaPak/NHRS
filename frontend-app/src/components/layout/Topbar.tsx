import { Command, PanelLeft } from 'lucide-react';
import { ContextSwitcher } from '@/components/navigation/ContextSwitcher';
import { NotificationBell } from '@/components/navigation/NotificationBell';
import { ProfileMenu } from '@/components/navigation/ProfileMenu';
import { Button } from '@/components/ui/Button';
import { useUIStore } from '@/stores/uiStore';

export function Topbar() {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setCommandPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur lg:px-6">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} className="lg:hidden" aria-label="Toggle navigation">
            <PanelLeft className="h-5 w-5" />
          </Button>
          <ContextSwitcher />
        </div>
        <div />
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setCommandPaletteOpen(true)} className="hidden md:inline-flex">
            <Command className="h-4 w-4" />
            Command Palette
          </Button>
          <NotificationBell />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
