import { create } from 'zustand';

type UIState = {
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  activeDrawer: string | null;
  activeModal: string | null;
  toggleSidebar: () => void;
  setSidebarOpen: (value: boolean) => void;
  setCommandPaletteOpen: (value: boolean) => void;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
  openModal: (id: string) => void;
  closeModal: () => void;
};

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  commandPaletteOpen: false,
  activeDrawer: null,
  activeModal: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (value) => set({ sidebarOpen: value }),
  setCommandPaletteOpen: (value) => set({ commandPaletteOpen: value }),
  openDrawer: (id) => set({ activeDrawer: id }),
  closeDrawer: () => set({ activeDrawer: null }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),
}));
