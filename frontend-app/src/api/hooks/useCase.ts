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
      const root = response.case && typeof response.case === 'object' ? (response.case as Record<string, unknown>) : response;
      const location = (root.location as Record<string, unknown> | undefined) ?? {};
      const actions = Array.isArray(response.recentActions) ? response.recentActions : Array.isArray(root.actions) ? root.actions : [];
      const notes = Array.isArray(root.notes) ? root.notes : [];
      const escalations = Array.isArray(root.escalations) ? root.escalations : [];
      const relatedComplaints = Array.isArray(root.relatedComplaints) ? root.relatedComplaints : [];

      return {
        id: String(root.caseId ?? root.id ?? id),
        caseId: String(root.caseId ?? root.id ?? id),
        sourceComplaint: String(root.sourceComplaint ?? root.originComplaintId ?? 'N/A'),
        institution: String(root.institution ?? root.organizationId ?? 'N/A'),
        state: String(location.state ?? root.state ?? 'N/A'),
        lga: String(location.lga ?? root.lga ?? 'N/A'),
        assignedOfficer: String(root.assignedOfficer ?? root.assignedTo ?? 'Unassigned'),
        severity: String(root.severity ?? root.priority ?? 'medium'),
        stage: String(root.currentStage ?? root.stage ?? 'intake'),
        status: String(root.status ?? 'open'),
        openedAt: String(root.createdAt ?? root.openedAt ?? new Date().toISOString()),
        updatedAt: String(root.updatedAt ?? root.createdAt ?? new Date().toISOString()),
        summary: String(root.description ?? root.subject ?? 'No case summary available'),
        jurisdiction: [location.lga, location.state].filter(Boolean).join(', ') || 'Not specified',
        nextAction: String(root.nextAction ?? 'Review and update case stage'),
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
