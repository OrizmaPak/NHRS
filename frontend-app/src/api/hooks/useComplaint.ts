import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { ComplaintRow } from '@/api/hooks/taskforceTypes';

type ComplaintDetail = ComplaintRow & {
  summary: string;
  notes: Array<{ id: string; message: string; author: string; createdAt: string }>;
  timeline: Array<{ id: string; title: string; detail: string; timestamp: string; badge?: string }>;
  attachments: Array<{ id: string; name: string }>;
};

export function useComplaint(id: string) {
  return useQuery({
    queryKey: ['taskforce', 'complaint', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ComplaintDetail> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.complaintById(id));
      const location = (response.location as Record<string, unknown> | undefined) ?? {};
      const notes = Array.isArray(response.notes) ? response.notes : [];
      const actions = Array.isArray(response.actions) ? response.actions : [];
      return {
        id: String(response.caseId ?? response.complaintId ?? response.id ?? id),
        complaintId: String(response.caseId ?? response.complaintId ?? response.id ?? id),
        complainant: String(response.complainant ?? response.createdByUserId ?? 'Anonymous'),
        anonymous: Boolean(response.anonymous ?? false),
        institution: String(response.institution ?? response.organizationId ?? 'N/A'),
        provider: String(response.provider ?? response.providerUserId ?? 'N/A'),
        state: String(location.state ?? response.state ?? 'N/A'),
        lga: String(location.lga ?? response.lga ?? 'N/A'),
        complaintType: String(response.caseType ?? response.complaintType ?? 'GENERAL'),
        priority: String(response.urgency ?? response.priority ?? 'medium'),
        status: String(response.status ?? 'open'),
        createdAt: String(response.createdAt ?? new Date().toISOString()),
        assignedTo: String(response.assignedOfficer ?? response.assignedTo ?? 'Unassigned'),
        linkedCaseId: response.linkedCaseId ? String(response.linkedCaseId) : undefined,
        summary: String(response.description ?? response.subject ?? 'No complaint summary available.'),
        notes: notes.map((note, index) => {
          const item = note as Record<string, unknown>;
          return {
            id: String(item.id ?? item.noteId ?? index),
            message: String(item.message ?? item.body ?? ''),
            author: String(item.author ?? item.createdBy ?? 'System'),
            createdAt: String(item.createdAt ?? new Date().toISOString()),
          };
        }),
        timeline: actions.map((action, index) => {
          const item = action as Record<string, unknown>;
          return {
            id: String(item.id ?? item.actionId ?? index),
            title: String(item.actionType ?? item.type ?? 'Update'),
            detail: String(item.detail ?? item.payload ?? 'Complaint workflow update'),
            timestamp: String(item.createdAt ?? new Date().toISOString()),
            badge: String(item.badge ?? 'Workflow'),
          };
        }),
        attachments: [],
      };
    },
  });
}
