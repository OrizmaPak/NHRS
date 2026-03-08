import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type InstitutionDashboardData = {
  patientsToday: number;
  pendingLabs: number;
  pendingPrescriptions: number;
  activeEmergencyAlerts: number;
  complianceStatus: string;
  recentEncounters: Array<{ id: string; patient: string; clinician: string; date: string; status: string }>;
  pendingLabResults: Array<{ id: string; patient: string; testType: string; requestedDate: string; status: string }>;
  pendingPrescriptionQueue: Array<{ id: string; patient: string; medication: string; date: string; status: string }>;
};

export function useInstitutionDashboard() {
  return useQuery({
    queryKey: ['institution', 'dashboard'],
    queryFn: async (): Promise<InstitutionDashboardData> => {
      try {
        const response = await apiClient.get<Record<string, unknown>>(endpoints.institution.dashboard);
        return {
          patientsToday: Number(response.patientsToday ?? 0),
          pendingLabs: Number(response.pendingLabs ?? 0),
          pendingPrescriptions: Number(response.pendingPrescriptions ?? 0),
          activeEmergencyAlerts: Number(response.activeEmergencyAlerts ?? 0),
          complianceStatus: String(response.complianceStatus ?? 'green'),
          recentEncounters: Array.isArray(response.recentEncounters)
            ? (response.recentEncounters as Array<Record<string, unknown>>).map((entry) => ({
                id: String(entry.id ?? crypto.randomUUID()),
                patient: String(entry.patient ?? 'Patient'),
                clinician: String(entry.clinician ?? 'Clinician'),
                date: String(entry.date ?? new Date().toISOString()),
                status: String(entry.status ?? 'open'),
              }))
            : [],
          pendingLabResults: Array.isArray(response.pendingLabResults)
            ? (response.pendingLabResults as Array<Record<string, unknown>>).map((entry) => ({
                id: String(entry.id ?? crypto.randomUUID()),
                patient: String(entry.patient ?? 'Patient'),
                testType: String(entry.testType ?? 'Lab Test'),
                requestedDate: String(entry.requestedDate ?? new Date().toISOString()),
                status: String(entry.status ?? 'pending'),
              }))
            : [],
          pendingPrescriptionQueue: Array.isArray(response.pendingPrescriptionQueue)
            ? (response.pendingPrescriptionQueue as Array<Record<string, unknown>>).map((entry) => ({
                id: String(entry.id ?? crypto.randomUUID()),
                patient: String(entry.patient ?? 'Patient'),
                medication: String(entry.medication ?? 'Medication'),
                date: String(entry.date ?? new Date().toISOString()),
                status: String(entry.status ?? 'pending'),
              }))
            : [],
        };
      } catch {
        return {
          patientsToday: 0,
          pendingLabs: 0,
          pendingPrescriptions: 0,
          activeEmergencyAlerts: 0,
          complianceStatus: 'unknown',
          recentEncounters: [],
          pendingLabResults: [],
          pendingPrescriptionQueue: [],
        };
      }
    },
  });
}

