import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormField } from '@/components/forms/FormField';

const noteSchema = z.object({
  content: z.string().min(2, 'Note is required').max(2000, 'Keep notes concise'),
});

type NoteFormValues = z.infer<typeof noteSchema>;

export type OperationalNote = {
  id: string;
  author: string;
  userId?: string;
  timestamp: string;
  content: string;
};

export function OperationalNotesPanel({
  title = 'Operational Notes',
  description = 'Team communication and execution notes.',
  notes,
  currentUserId,
  onAdd,
  onEdit,
  onDelete,
}: {
  title?: string;
  description?: string;
  notes: OperationalNote[];
  currentUserId?: string;
  onAdd?: (content: string) => Promise<void>;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<NoteFormValues>({
    resolver: zodResolver(noteSchema),
    defaultValues: { content: '' },
  });

  const ordered = useMemo(
    () => [...notes].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [notes],
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>

      <form
        className="space-y-2"
        onSubmit={handleSubmit(async (values) => {
          if (!onAdd) return;
          await onAdd(values.content);
          reset();
        })}
      >
        <FormField label="Add note" error={errors.content?.message}>
          <textarea
            {...register('content')}
            className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            placeholder="Share operational context for team continuity"
          />
        </FormField>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || !onAdd}>
            Add Note
          </Button>
        </div>
      </form>

      <div className="mt-4 space-y-3">
        {ordered.map((note) => {
          const canModify = Boolean(currentUserId && note.userId && currentUserId === note.userId);
          return (
            <div key={note.id} className="rounded-md border border-border p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
                <span>{note.author}</span>
                <span>{new Date(note.timestamp).toLocaleString()}</span>
              </div>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    className="min-h-20 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={async () => {
                        if (!onEdit || !editingId) return;
                        await onEdit(editingId, editingContent);
                        setEditingId(null);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground">{note.content}</p>
              )}
              {canModify && editingId !== note.id ? (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingId(note.id);
                      setEditingContent(note.content);
                    }}
                  >
                    Edit
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => onDelete?.(note.id)}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {ordered.length === 0 ? <p className="text-sm text-muted">No operational notes yet.</p> : null}
      </div>
    </Card>
  );
}

