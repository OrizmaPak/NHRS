import { useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, UploadCloud } from 'lucide-react';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { FormField } from '@/components/forms/FormField';

type LogoState = {
  lightUrl?: string;
  darkUrl?: string;
  markUrl?: string;
};

type Variant = 'light' | 'dark' | 'mark';

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/svg+xml'];

function validateFile(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) {
    return 'Only PNG, JPG, and SVG files are allowed.';
  }
  if (file.size > MAX_SIZE_BYTES) {
    return 'File must be less than 2MB.';
  }
  return null;
}

async function uploadLogo(themeId: string, variant: Variant, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('variant', variant);

  const response = await apiClient.post<Record<string, unknown>>(endpoints.uiTheme.logo(themeId), form);
  return String(
    response.url ??
      response.logoUrl ??
      response.lightUrl ??
      response.darkUrl ??
      response.markUrl ??
      URL.createObjectURL(file),
  );
}

function DropZone({
  variant,
  label,
  hint,
  currentUrl,
  themeId,
  onUploaded,
}: {
  variant: Variant;
  label: string;
  hint: string;
  currentUrl?: string;
  themeId?: string;
  onUploaded: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(() => currentUrl, [currentUrl]);

  const processFile = async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      if (themeId) {
        const uploadedUrl = await uploadLogo(themeId, variant, file);
        onUploaded(uploadedUrl);
      } else {
        onUploaded(URL.createObjectURL(file));
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormField label={label} hint={hint} error={error ?? undefined}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void processFile(file);
        }}
        className={`rounded-xl border border-dashed p-4 transition-colors ${
          dragActive ? 'border-primary bg-primary/5' : 'border-border bg-surface'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void processFile(file);
          }}
        />

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md border border-border bg-background">
              {preview ? (
                <img src={preview} alt={`${label} preview`} className="h-7 w-7 object-contain" />
              ) : (
                <ImagePlus className="h-5 w-5 text-muted" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted">PNG, JPG, SVG up to 2MB</p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {loading ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
      </div>
    </FormField>
  );
}

export function LogoUploader({
  value,
  themeId,
  onChange,
}: {
  value: LogoState;
  themeId?: string;
  onChange: (next: LogoState) => void;
}) {
  return (
    <div className="space-y-3">
      <DropZone
        variant="light"
        label="Light logo"
        hint="Shown on light surfaces and default navigation."
        currentUrl={value.lightUrl}
        themeId={themeId}
        onUploaded={(url) => onChange({ ...value, lightUrl: url })}
      />
      <DropZone
        variant="dark"
        label="Dark logo"
        hint="Shown in dark mode and dark surfaces."
        currentUrl={value.darkUrl}
        themeId={themeId}
        onUploaded={(url) => onChange({ ...value, darkUrl: url })}
      />
      <DropZone
        variant="mark"
        label="Mark logo"
        hint="Compact icon mark for collapsed navigation."
        currentUrl={value.markUrl}
        themeId={themeId}
        onUploaded={(url) => onChange({ ...value, markUrl: url })}
      />
    </div>
  );
}
