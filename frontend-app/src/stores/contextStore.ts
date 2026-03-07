import { create } from 'zustand';
import { CONTEXT_STORAGE_KEY } from '@/lib/constants';
import type { AppContext } from '@/types/auth';

type ContextState = {
  availableContexts: AppContext[];
  activeContext: AppContext | null;
  initialized: boolean;
  setAvailableContexts: (contexts: AppContext[]) => void;
  setActiveContext: (context: AppContext | null) => void;
  switchContext: (contextId: string) => AppContext | null;
  reset: () => void;
};

function getStoredContextId(): string | null {
  return localStorage.getItem(CONTEXT_STORAGE_KEY);
}

export const useContextStore = create<ContextState>((set, get) => ({
  availableContexts: [],
  activeContext: null,
  initialized: false,

  setAvailableContexts: (contexts) => {
    const storedContextId = getStoredContextId();
    const nextActive =
      contexts.find((context) => context.id === storedContextId) ??
      contexts[0] ??
      null;

    if (nextActive) {
      localStorage.setItem(CONTEXT_STORAGE_KEY, nextActive.id);
    } else {
      localStorage.removeItem(CONTEXT_STORAGE_KEY);
    }

    set({
      availableContexts: contexts,
      activeContext: nextActive,
      initialized: true,
    });
  },

  setActiveContext: (context) => {
    if (context) {
      localStorage.setItem(CONTEXT_STORAGE_KEY, context.id);
    } else {
      localStorage.removeItem(CONTEXT_STORAGE_KEY);
    }

    set({ activeContext: context, initialized: true });
  },

  switchContext: (contextId) => {
    const next = get().availableContexts.find((context) => context.id === contextId) ?? null;
    if (next) {
      localStorage.setItem(CONTEXT_STORAGE_KEY, next.id);
      set({ activeContext: next });
    }
    return next;
  },

  reset: () => {
    localStorage.removeItem(CONTEXT_STORAGE_KEY);
    set({
      availableContexts: [],
      activeContext: null,
      initialized: false,
    });
  },
}));
