import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import type { CaseNote, CaseRow } from '@/api/hooks/taskforceTypes';

export type CaseDetail = CaseRow & {
  summary: string;
  jurisdiction: string;
  nextAction: string;
  timeline: Array<{ id: string; title: string; detail: string; timestamp: string; badge?: string }>;
  escalations: Array<{ id: string; level: string; target: string; reason: string; createdAt: string }>;
  audit: Array<{ id: string; action: string; actor: string; timestamp: string }>;
  relatedComplaints: Array<{ id: string; complaintId: string; status: string; priority: string; createdAt: string }>;
  notes: CaseNote[];
};

export function useCase(id: string) {
  return useQuery({
    queryKey: ['taskforce', 'case', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<CaseDetail> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.taskforce.caseById(id));
      const location = (response.location as Record<string, unknown> | undefined) ?? {};
      const actions = Array.isArray(response.actions) ? response.actions : [];
      const notes = Array.isArray(response.notes) ? response.notes : [];
      const escalations = Array.isArray(response.escalations) ? response.escalations : [];
      const relatedComplaints = Array.isArray(response.relatedComplaints) ? response.relatedComplaints : [];

      return {
        id: String(response.caseId ?? response.id ?? id),
        caseId: String(response.caseId ?? response.id ?? id),
        sourceComplaint: String(response.sourceComplaint ?? response.originComplaintId ?? 'N/A'),
        institution: String(response.institution ?? response.organizationId ?? 'N/A'),
        state: String(location.state ?? response.state ?? 'N/A'),
        lga: String(location.lga ?? response.lga ?? 'N/A'),
        assignedOfficer: String(response.assignedOfficer ?? response.assignedTo ?? 'Unassigned'),
        severity: String(response.severity ?? response.priority ?? 'medium'),
        stage: String(response.currentStage ?? response.stage ?? 'intake'),
        status: String(response.status ?? 'open'),
        openedAt: String(response.createdAt ?? response.openedAt ?? new Date().toISOString()),
        updatedAt: String(response.updatedAt ?? response.createdAt ?? new Date().toISOString()),
        summary: String(response.description ?? response.subject ?? 'No case summary available'),
        jurisdiction: [location.lga, location.state].filter(Boolean).join(', ') || 'Not specified',
        nextAction: String(response.nextAction ?? 'Review and update case stage'),
        timeline: actions.map((item, index) => {
          const action = item as Record<string, unknown>;
          return {
            id: String(action.id ?? action.actionId ?? index),
            title: String(action.actionType ?? action.type ?? 'Case update'),
            detail: String(action.detail ?? action.payload ?? 'Workflow event'),
            timestamp: String(action.createdAt ?? new Date().toISOString()),
            badge: String(action.badge ?? 'Case'),
          };
        }),
        escalations: escalations.map((item, index) => {
          const escalation = item as Record<string, unknown>;
          return {
            id: String(escalation.id ?? escalation.escalationId ?? index),
            level: String(escalation.level ?? escalation.targetLevel ?? 'STATE'),
            target: String(escalation.targetUnit ?? escalation.target ?? 'Unassigned'),
            reason: String(escalation.reason ?? 'Escalated for further review'),
            createdAt: String(escalation.createdAt ?? new Date().toISOString()),
          };
        }),
        audit: actions.map((item, index) => {
          const action = item as Record<string, unknown>;
          return {
            id: String(action.id ?? `audit-${index}`),
            action: String(action.actionType ?? action.type ?? 'updated'),
            actor: String(action.performedBy ?? action.actor ?? 'System'),
            timestamp: String(action.createdAt ?? new Date().toISOString()),
          };
        }),
        relatedComplaints: relatedComplaints.map((item, index) => {
          const complaint = item as Record<string, unknown>;
          return {
            id: String(complaint.id ?? index),
            complaintId: String(complaint.complaintId ?? complaint.caseId ?? `CMP-${index + 1}`),
            status: String(complaint.status ?? 'open'),
            priority: String(complaint.priority ?? 'medium'),
            createdAt: String(complaint.createdAt ?? new Date().toISOString()),
          };
        }),
        notes: notes.map((item, index) => {
          const note = item as Record<string, unknown>;
          return {
            id: String(note.id ?? note.noteId ?? index),
            message: String(note.message ?? note.body ?? ''),
            author: String(note.author ?? note.createdBy ?? 'System'),
            createdAt: String(note.createdAt ?? new Date().toISOString()),
          };
        }),
      };
    },
  });
}
