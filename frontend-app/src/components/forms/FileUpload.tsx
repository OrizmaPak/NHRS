import { UploadCloud } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/Button';

export function FileUpload({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept?: string;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-4">
      <input
        ref={ref}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted">PNG, JPG, SVG up to 2MB</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
          <UploadCloud className="h-4 w-4" />
          Upload
        </Button>
      </div>
    </div>
  );
}
