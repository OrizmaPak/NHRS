export type ScopeLevel = 'LGA' | 'STATE' | 'REGION' | 'NATIONAL';

export type TaskforceKpis = {
  activeComplaints: number;
  openCases: number;
  escalatedCases: number;
  overdueComplaints: number;
  institutionsUnderReview: number;
  recentAuditEvents: number;
};

export type ComplaintRow = {
  id: string;
  complaintId: string;
  complainant: string;
  anonymous: boolean;
  institution: string;
  provider: string;
  state: string;
  lga: string;
  complaintType: string;
  priority: string;
  status: string;
  createdAt: string;
  assignedTo: string;
  linkedCaseId?: string;
};

export type CaseRow = {
  id: string;
  caseId: string;
  sourceComplaint: string;
  institution: string;
  state: string;
  lga: string;
  assignedOfficer: string;
  severity: string;
  stage: string;
  status: string;
  openedAt: string;
  updatedAt: string;
};

export type CaseNote = {
  id: string;
  message: string;
  author: string;
  createdAt: string;
};

export type AuditEventRow = {
  id: string;
  eventId: string;
  actor: string;
  actorType?: string;
  actorRole: string;
  action: string;
  module: string;
  targetType: string;
  targetId: string;
  institution: string;
  state: string;
  outcome?: string;
  summary?: string;
  timestamp: string;
};

export type OversightSummary = {
  institutionsFlagged: number;
  unresolvedHighPriorityComplaints: number;
  overdueCases: number;
  recentEscalations: number;
};
