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
      const root = response.case && typeof response.case === 'object' ? (response.case as Record<string, unknown>) : response;
      const location = (root.location as Record<string, unknown> | undefined) ?? {};
      const notes = Array.isArray(root.notes) ? root.notes : [];
      const actions = Array.isArray(response.recentActions) ? response.recentActions : Array.isArray(root.actions) ? root.actions : [];
      return {
        id: String(root.caseId ?? root.complaintId ?? root.id ?? id),
        complaintId: String(root.caseId ?? root.complaintId ?? root.id ?? id),
        complainant: String(root.complainant ?? root.createdByUserId ?? 'Anonymous'),
        anonymous: Boolean(root.anonymous ?? false),
        institution: String(root.institution ?? root.organizationId ?? 'N/A'),
        provider: String(root.provider ?? root.providerUserId ?? 'N/A'),
        state: String(location.state ?? root.state ?? 'N/A'),
        lga: String(location.lga ?? root.lga ?? 'N/A'),
        complaintType: String(root.caseType ?? root.complaintType ?? 'GENERAL'),
        priority: String(root.urgency ?? root.priority ?? 'medium'),
        status: String(root.status ?? 'open'),
        createdAt: String(root.createdAt ?? new Date().toISOString()),
        assignedTo: String(root.assignedOfficer ?? root.assignedTo ?? 'Unassigned'),
        linkedCaseId: root.linkedCaseId ? String(root.linkedCaseId) : undefined,
        summary: String(root.description ?? root.subject ?? 'No complaint summary available.'),
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
