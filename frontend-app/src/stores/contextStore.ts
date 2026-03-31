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

function contextSignature(context: AppContext): string {
  return [
    context.id,
    context.type,
    context.name,
    context.subtitle ?? '',
    context.roleName ?? '',
    context.themeScopeType,
    context.themeScopeId ?? '',
    context.organizationId ?? '',
    context.institutionId ?? '',
    context.branchId ?? '',
    JSON.stringify(
      Array.isArray(context.permissions)
        ? context.permissions.map((permission) => String(permission || '').trim()).filter(Boolean).sort()
        : [],
    ),
  ].join('::');
}

function contextsEqual(left: AppContext[], right: AppContext[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (contextSignature(left[i]) !== contextSignature(right[i])) return false;
  }
  return true;
}

export const useContextStore = create<ContextState>((set, get) => ({
  availableContexts: [],
  activeContext: null,
  initialized: false,

  setAvailableContexts: (contexts) => {
    const storedContextId = getStoredContextId();
    const previous = get();
    const nextActive =
      contexts.find((context) => context.id === storedContextId) ??
      contexts[0] ??
      null;

    const sameContexts = contextsEqual(previous.availableContexts, contexts);
    const sameActive = previous.activeContext?.id === nextActive?.id;
    if (previous.initialized && sameContexts && sameActive) {
      return;
    }

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
    const previous = get().activeContext;
    if (previous?.id === context?.id) {
      return;
    }

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
      if (get().activeContext?.id === next.id) {
        return next;
      }
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
