import { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/feedback/Spinner';

type Option = { value: string; label: string; description?: string };

export function SmartSelect({
  value,
  onChange,
  loadOptions,
  placeholder = 'Select option',
  emptyLabel = 'No result found',
}: {
  value: string | null;
  onChange: (value: string) => void;
  loadOptions: (search: string) => Promise<Option[]>;
  placeholder?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<Option[]>([]);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    let active = true;

    loadOptions(debouncedQuery)
      .then((result) => {
        if (active) setOptions(result);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, loadOptions]);

  const selectedLabel = useMemo(() => options.find((option) => option.value === value)?.label, [options, value]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-md border border-border bg-white px-3 text-sm text-foreground"
        >
          <span className={cn('truncate text-left', !selectedLabel && 'text-muted')}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={8} className="z-50 w-[var(--radix-popover-trigger-width)] rounded-lg border border-border bg-surface p-2 shadow-soft">
          <Command className="w-full" shouldFilter={false}>
            <Command.Input
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setLoading(true);
              }}
              placeholder="Type to search"
              className="mb-2 h-9 w-full rounded-md border border-border px-3 text-sm outline-none"
            />
            <Command.List className="max-h-64 overflow-auto">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted">
                  <Spinner className="h-4 w-4" />
                  Loading options...
                </div>
              ) : (
                <>
                  <Command.Empty className="px-2 py-4 text-sm text-muted">{emptyLabel}</Command.Empty>
                  {options.map((option) => (
                    <Command.Item
                      key={option.value}
                      value={`${option.label} ${option.description ?? ''}`}
                      onSelect={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm aria-selected:bg-primary/10"
                    >
                      <div>
                        <p className="font-medium text-foreground">{option.label}</p>
                        {option.description ? <p className="text-xs text-muted">{option.description}</p> : null}
                      </div>
                      {value === option.value ? <Check className="h-4 w-4 text-primary" /> : null}
                    </Command.Item>
                  ))}
                </>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
