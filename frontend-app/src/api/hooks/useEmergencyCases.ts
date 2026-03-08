import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type EmergencyCase = {
  id: string;
  caseId: string;
  incidentType: string;
  state: string;
  lga: string;
  institution: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  assignedResponder: string;
  createdAt: string;
  reportedBy: string;
  description: string;
};

export type EmergencyCaseResource = {
  id: string;
  resourceType: string;
  originFacility: string;
  status: string;
  assignedTeam: string;
  dispatchTime: string;
};

export type EmergencyCaseTimelineItem = {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  badge?: string;
};

export type EmergencyCaseNote = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  canEdit: boolean;
};

export type LinkedPatient = {
  id: string;
  nin: string;
  name: string;
  status: string;
};

export type EmergencyCaseDetails = EmergencyCase & {
  resources: EmergencyCaseResource[];
  timeline: EmergencyCaseTimelineItem[];
  notes: EmergencyCaseNote[];
  linkedPatients: LinkedPatient[];
};

export type EmergencyCasesParams = {
  page: number;
  limit: number;
  incidentType?: string;
  priority?: string;
  status?: string;
  state?: string;
  lga?: string;
  institution?: string;
};

type EmergencyCasesResult = {
  rows: EmergencyCase[];
  total: number;
};

function toEmergencyCase(item: Record<string, unknown>): EmergencyCase {
  const location = (item.location as Record<string, unknown> | undefined) ?? {};
  const scope = (item.scope as Record<string, unknown> | undefined) ?? {};
  return {
    id: String(item.requestId ?? item.caseId ?? item.id ?? crypto.randomUUID()),
    caseId: String(item.requestId ?? item.caseId ?? item.id ?? crypto.randomUUID()),
    incidentType: String(item.category ?? item.incidentType ?? 'general_incident'),
    state: String(location.state ?? scope.state ?? 'N/A'),
    lga: String(location.lga ?? scope.lga ?? 'N/A'),
    institution: String(item.institution ?? item.providerOrgId ?? item.providerOrgName ?? 'Unspecified'),
    priority: String(item.urgency ?? item.priority ?? 'medium').toLowerCase() as EmergencyCase['priority'],
    status: String(item.status ?? 'open'),
    assignedResponder: String(item.assignedResponder ?? item.assignedTo ?? 'Unassigned'),
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    reportedBy: String(item.createdByUserId ?? item.reportedBy ?? 'System'),
    description: String(item.description ?? item.title ?? ''),
  };
}

export function useEmergencyCases(params: EmergencyCasesParams) {
  return useQuery({
    queryKey: ['emergency', 'cases', params],
    queryFn: async (): Promise<EmergencyCasesResult> => {
      const response = await apiClient.get<Record<string, unknown>>(endpoints.emergency.requests, {
        query: {
          page: params.page,
          limit: params.limit,
          status: params.status,
          state: params.state,
          lga: params.lga,
          category: params.incidentType,
          urgency: params.priority,
          institution: params.institution,
        },
      });

      const items =
        (Array.isArray(response.items) ? response.items : null) ??
        (Array.isArray(response.data) ? response.data : null) ??
        [];

      const rows = items
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map(toEmergencyCase);

      return {
        rows,
        total: Number(response.total ?? rows.length),
      };
    },
  });
}

export function useEmergencyCase(id: string) {
  return useQuery({
    queryKey: ['emergency', 'case', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<EmergencyCaseDetails> => {
      const [caseResponse, responsesResponse, roomResponse] = await Promise.all([
        apiClient.get<Record<string, unknown>>(endpoints.emergency.caseById(id)),
        apiClient.get<Record<string, unknown>>(endpoints.emergency.caseResponses(id)),
        apiClient.get<Record<string, unknown>>(endpoints.emergency.caseRoom(id)).catch(
          () => ({} as Record<string, unknown>),
        ),
      ]);

      const base = toEmergencyCase(caseResponse);

      const responseItems =
        (Array.isArray(responsesResponse.items) ? responsesResponse.items : null) ??
        (Array.isArray(responsesResponse.data) ? responsesResponse.data : null) ??
        [];
      const roomId = String(roomResponse.roomId ?? roomResponse.id ?? '');
      const messagesResponse: Record<string, unknown> = roomId
        ? await apiClient
            .get<Record<string, unknown>>(endpoints.emergency.roomMessages(roomId))
            .catch(() => ({} as Record<string, unknown>))
        : {};
      const messageItems =
        (Array.isArray(messagesResponse.items) ? messagesResponse.items : null) ??
        (Array.isArray(messagesResponse.data) ? messagesResponse.data : null) ??
        [];

      const resources = responseItems
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          id: String(item.responseId ?? item.id ?? crypto.randomUUID()),
          resourceType: String(item.responseType ?? item.resourceType ?? 'resource'),
          originFacility: String(item.providerOrgId ?? item.originFacility ?? 'Unknown'),
          status: String(item.availability ? 'available' : item.status ?? 'pending'),
          assignedTeam: String(item.providerUserId ?? item.assignedTeam ?? 'Unassigned'),
          dispatchTime: String(item.createdAt ?? new Date().toISOString()),
        }));

      const timeline: EmergencyCaseTimelineItem[] = [
        {
          id: `event-create-${base.id}`,
          title: 'Case reported',
          description: base.description || `${base.incidentType} reported`,
          timestamp: base.createdAt,
          badge: 'Incident',
        },
        ...resources.map((resource) => ({
          id: `event-dispatch-${resource.id}`,
          title: `Resource update: ${resource.resourceType}`,
          description: `${resource.originFacility} -> ${resource.status}`,
          timestamp: resource.dispatchTime,
          badge: 'Dispatch',
        })),
        ...messageItems
          .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object'))
          .map((message: Record<string, unknown>) => ({
            id: `event-msg-${String(message.messageId ?? message.id ?? crypto.randomUUID())}`,
            title: 'Operational note',
            description: String(message.body ?? ''),
            timestamp: String(message.createdAt ?? new Date().toISOString()),
            badge: 'Note',
          })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const linkedPatients: LinkedPatient[] =
        Array.isArray(caseResponse.linkedPatients)
          ? (caseResponse.linkedPatients as Array<Record<string, unknown>>).map((patient) => ({
              id: String(patient.id ?? crypto.randomUUID()),
              nin: String(patient.nin ?? 'N/A'),
              name: String(patient.name ?? 'Patient'),
              status: String(patient.status ?? 'stable'),
            }))
          : [];

      return {
        ...base,
        resources,
        timeline,
        notes: messageItems
          .filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object'))
          .map((message: Record<string, unknown>) => ({
            id: String(message.messageId ?? message.id ?? crypto.randomUUID()),
            author: String(message.senderUserId ?? message.author ?? 'Operator'),
            content: String(message.body ?? ''),
            createdAt: String(message.createdAt ?? new Date().toISOString()),
            canEdit: false,
          })),
        linkedPatients,
      };
    },
  });
}

export function useDispatchResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      caseId: string;
      resourceType: string;
      originInstitution: string;
      destination: string;
      priority: string;
      notes?: string;
    }) =>
      apiClient.post(endpoints.emergency.caseResponses(payload.caseId), {
        responseType: payload.resourceType,
        availability: true,
        transferOptions: payload.destination,
        notes: payload.notes,
        priority: payload.priority,
        providerOrgId: payload.originInstitution,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['emergency', 'case', variables.caseId] }),
        queryClient.invalidateQueries({ queryKey: ['emergency', 'cases'] }),
      ]);
    },
  });
}

export function useUpdateEmergencyCaseStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { caseId: string; status: string; reason?: string; assignedResponder?: string }) =>
      apiClient.patch(endpoints.emergency.updateStatus(payload.caseId), {
        status: payload.status,
        reason: payload.reason,
        assignedResponder: payload.assignedResponder,
      }),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['emergency', 'case', variables.caseId] }),
        queryClient.invalidateQueries({ queryKey: ['emergency', 'cases'] }),
      ]);
    },
  });
}

export function useAddEmergencyCaseNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: { caseId: string; message: string }) => {
      const roomResponse = await apiClient.get<Record<string, unknown>>(endpoints.emergency.caseRoom(payload.caseId));
      const roomId = String(roomResponse.roomId ?? roomResponse.id ?? '');
      if (!roomId) throw new Error('Case room unavailable');

      return apiClient.post(endpoints.emergency.roomMessages(roomId), {
        body: payload.message,
      });
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['emergency', 'case', variables.caseId] });
    },
  });
}

