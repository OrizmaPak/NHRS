import * as Select from '@radix-ui/react-select';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useContexts } from '@/api/hooks/useContexts';
import { useSwitchContext } from '@/api/hooks/useSwitchContext';

export function ContextSwitcher() {
  const { availableContexts, activeContext, isLoading } = useContexts();
  const switchContextMutation = useSwitchContext();

  if (isLoading) {
    return (
      <div className="inline-flex h-10 min-w-[180px] items-center rounded-md border border-border bg-surface px-3 text-sm text-muted md:min-w-[220px]">
        Loading contexts...
      </div>
    );
  }

  if (!availableContexts.length) {
    return (
      <div className="inline-flex h-10 min-w-[180px] items-center rounded-md border border-border bg-surface px-3 text-sm text-muted md:min-w-[220px]">
        No contexts available
      </div>
    );
  }

  return (
    <Select.Root
      value={activeContext?.id ?? ''}
      onValueChange={(contextId) => {
        if (contextId === activeContext?.id) return;
        switchContextMutation.mutate(contextId);
      }}
      disabled={switchContextMutation.isPending}
    >
      <Select.Trigger
        className="inline-flex h-10 min-w-[180px] items-center justify-between rounded-md border border-border bg-surface px-3 text-sm text-foreground shadow-subtle md:min-w-[220px]"
        aria-label="Context Switcher"
      >
        <Select.Value placeholder="Select context" />
        <Select.Icon>
          <ChevronsUpDown className="h-4 w-4 text-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 max-h-80 w-[280px] overflow-hidden rounded-lg border border-border bg-surface shadow-soft">
          <Select.Viewport className="p-1">
            {availableContexts.map((context) => (
              <Select.Item
                key={context.id}
                value={context.id}
                className="relative cursor-pointer rounded-md px-8 py-2 text-sm text-foreground outline-none data-[highlighted]:bg-primary/10"
              >
                <Select.ItemText>{context.name}</Select.ItemText>
                {context.subtitle ? <p className="text-xs text-muted">{context.subtitle}</p> : null}
                <Select.ItemIndicator className="absolute left-2 top-2.5">
                  <Check className="h-4 w-4 text-primary" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
