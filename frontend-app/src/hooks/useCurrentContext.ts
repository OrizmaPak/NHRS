import { useContextStore } from '@/stores/contextStore';

export function useCurrentContext() {
  const activeContext = useContextStore((state) => state.activeContext);
  const availableContexts = useContextStore((state) => state.availableContexts);
  return { activeContext, availableContexts };
}
