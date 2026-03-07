import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { CaseNote } from '@/api/hooks/taskforceTypes';

export function useCaseNotes(caseId: string) {
  return useQuery({
    queryKey: ['taskforce', 'case', caseId, 'notes'],
    enabled: Boolean(caseId),
    queryFn: async (): Promise<CaseNote[]> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.caseNotes(caseId));
      const notes =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.notes) ? response.notes : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];
      return notes.map((item, index) => {
        const note = item as Record<string, unknown>;
        return {
          id: String(note.id ?? note.noteId ?? index),
          message: String(note.message ?? note.body ?? ''),
          author: String(note.author ?? note.createdBy ?? 'System'),
          createdAt: String(note.createdAt ?? new Date().toISOString()),
        };
      });
    },
  });
}
