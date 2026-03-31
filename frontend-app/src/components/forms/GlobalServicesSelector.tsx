import { useMemo, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/overlays/Modal';
import { usePermissionsStore } from '@/stores/permissionsStore';
import {
  getGlobalServiceKey,
  mergeGlobalServiceNames,
  normalizeGlobalServiceName,
  useCreateGlobalService,
} from '@/api/hooks/useGlobalServices';

type GlobalServiceOption = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  options: GlobalServiceOption[];
  values: string[];
  onChange: (next: string[]) => void;
  excludeValue?: string | null;
  entityLabel: string;
};

export function GlobalServicesSelector({
  options,
  values,
  onChange,
  excludeValue,
  entityLabel,
}: Props) {
  const createGlobalService = useCreateGlobalService();
  const hasPermission = usePermissionsStore((state) => state.hasPermission);
  const [addOpen, setAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [error, setError] = useState('');
  const canCreateGlobalService = hasPermission('global.services.manage') || hasPermission('global.services.create');

  const optionKeys = useMemo(
    () => new Set(options.map((option) => getGlobalServiceKey(option.value))),
    [options],
  );
  const selectedValueKeys = useMemo(
    () => new Set(values.map((value) => getGlobalServiceKey(value))),
    [values],
  );
  const selectedOptionMeta = useMemo(() => {
    const byKey = new Map<string, GlobalServiceOption>();
    for (const option of options) {
      byKey.set(getGlobalServiceKey(option.value), option);
    }
    for (const value of values) {
      const key = getGlobalServiceKey(value);
      if (!byKey.has(key)) {
        byKey.set(key, { value, label: value });
      }
    }
    return byKey;
  }, [options, values]);
  const normalizedSearch = normalizeGlobalServiceName(searchTerm);
  const normalizedSearchKey = getGlobalServiceKey(normalizedSearch);
  const filteredOptions = useMemo(() => {
    const needle = String(searchTerm || '').trim().toLowerCase();
    return options.filter((option) => {
      if (selectedValueKeys.has(getGlobalServiceKey(option.value))) {
        return false;
      }
      if (!needle) return true;
      const label = String(option.label || '').toLowerCase();
      const description = String(option.description || '').toLowerCase();
      return label.includes(needle) || description.includes(needle);
    });
  }, [options, searchTerm, selectedValueKeys]);
  const hasExactMatch = normalizedSearchKey ? optionKeys.has(normalizedSearchKey) : false;

  async function handleAddService() {
    const normalized = normalizeGlobalServiceName(draftName);
    const normalizedKey = getGlobalServiceKey(normalized);
    const excludedKey = getGlobalServiceKey(excludeValue || '');

    if (!normalized) {
      setError('Enter a service name first.');
      return;
    }
    if (String(draftDescription || '').trim().length < 8) {
      setError('Add a short description so people know when to use this service.');
      return;
    }
    if (excludedKey && normalizedKey === excludedKey) {
      setError('This service is already covered by the selected type.');
      return;
    }
    if (optionKeys.has(normalizedKey)) {
      setError('That service already exists globally. Select it from the list instead.');
      return;
    }

    try {
      await createGlobalService.mutateAsync({
        name: normalized,
        description: String(draftDescription || '').trim(),
      });
      onChange(mergeGlobalServiceNames([...values, normalized]));
      setDraftName('');
      setDraftDescription('');
      setError('');
      setAddOpen(false);
    } catch (entryError) {
      setError(entryError instanceof Error ? entryError.message : 'Unable to add service right now.');
    }
  }

  return (
    <div className="space-y-3">
      {values.length > 0 ? (
        <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/10 via-surface to-surface p-4 shadow-subtle">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Selected Services</p>
                <p className="text-xs text-muted">These services will be attached to this {entityLabel}.</p>
              </div>
            </div>
            <span className="rounded-full border border-primary/20 bg-white/80 px-2.5 py-1 text-xs font-medium text-primary shadow-sm">
              {values.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {values.map((value) => {
              const meta = selectedOptionMeta.get(getGlobalServiceKey(value));
              const hoverDescription = String(meta?.description || '').trim();
              return (
              <span
                key={getGlobalServiceKey(value)}
                className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/90 px-3 py-1.5 text-sm text-foreground shadow-sm transition-transform hover:-translate-y-0.5"
                title={hoverDescription || undefined}
              >
                <span className="font-medium">{value}</span>
                <button
                  type="button"
                  className="rounded-full bg-danger/10 p-1 text-danger transition-colors hover:bg-danger/15"
                  aria-label={`Remove ${value}`}
                  onClick={() => {
                    onChange(values.filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(value)));
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            );})}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <Input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder={`Search ${entityLabel} services`}
        />
        {normalizedSearch && canCreateGlobalService ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraftName(normalizedSearch);
              setDraftDescription('');
              setError('');
              setAddOpen(true);
            }}
          >
            Add as a service
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-3">
        {filteredOptions.map((option) => {
          const checked = values.some((entry) => getGlobalServiceKey(entry) === getGlobalServiceKey(option.value));
          return (
            <label key={option.value} className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? mergeGlobalServiceNames([...values, option.value])
                    : values.filter((entry) => getGlobalServiceKey(entry) !== getGlobalServiceKey(option.value));
                  onChange(next);
                }}
              />
              <span>
                <span className="block">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs text-muted">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
        {filteredOptions.length === 0 ? (
          <p className="md:col-span-3 text-sm text-muted">No matching services found.</p>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          Missing a service? Add it here and it will be saved globally for future institution and branch setup.
        </p>
        {canCreateGlobalService ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDraftName(normalizedSearch || '');
              setDraftDescription('');
              setError('');
              setAddOpen(true);
            }}
          >
            Add Service
          </Button>
        ) : null}
      </div>

      <Modal open={addOpen} onOpenChange={setAddOpen} title="Add Global Service">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Service Name</label>
            <Input
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
                if (error) setError('');
              }}
              placeholder={`Add a service for this ${entityLabel}`}
            />
            {hasExactMatch && getGlobalServiceKey(draftName) === normalizedSearchKey ? (
              <p className="mt-2 text-xs text-amber-700">
                A service with this exact name already exists globally. Select it from the list instead.
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Description</label>
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              value={draftDescription}
              onChange={(event) => {
                setDraftDescription(event.target.value);
                if (error) setError('');
              }}
              placeholder="Example: Vaccination, outpatient immunization visits, and related cold-chain support."
            />
          </div>
          <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Please ensure you are not creating a duplicate service that already exists. It will reduce visibility.
          </p>
          <p className="text-xs text-muted">
            This adds the service to the global list for everyone and selects it here immediately.
          </p>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddOpen(false);
                setDraftName('');
                setDraftDescription('');
                setError('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={createGlobalService.isPending}
              loadingText="Adding..."
              onClick={() => {
                void handleAddService();
              }}
            >
              Add
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </div>
  );
}
