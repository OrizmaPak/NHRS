import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { CommandPalette } from '@/components/navigation/CommandPalette';
import { Drawer } from '@/components/overlays/Drawer';
import { Modal } from '@/components/overlays/Modal';
import { useUIStore } from '@/stores/uiStore';

export function AppShell() {
  const activeDrawer = useUIStore((state) => state.activeDrawer);
  const closeDrawer = useUIStore((state) => state.closeDrawer);
  const activeModal = useUIStore((state) => state.activeModal);
  const closeModal = useUIStore((state) => state.closeModal);
  const setCommandPaletteOpen = useUIStore((state) => state.setCommandPaletteOpen);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCommandPaletteOpen]);

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full">
        <Sidebar />
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-20 bg-slate-900/25 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:pl-0">
          <Topbar />
          <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>

      <CommandPalette />

      <Drawer open={Boolean(activeDrawer)} onOpenChange={(open) => (!open ? closeDrawer() : undefined)} title="Quick drawer">
        <p className="text-sm text-muted">Context-aware drawer content can be mounted here.</p>
      </Drawer>

      <Modal open={Boolean(activeModal)} onOpenChange={(open) => (!open ? closeModal() : undefined)} title="Global modal">
        <p className="text-sm text-muted">Reusable modal host for confirmations and action forms.</p>
      </Modal>
    </div>
  );
}
