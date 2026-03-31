import { useMemo } from 'react';
import { useEncounters } from '@/api/hooks/useEncounters';
import { useLabs } from '@/api/hooks/useLabs';
import { usePharmacyRecords } from '@/api/hooks/usePharmacyRecords';

type HistoryItem = {
  id: string;
  type: 'encounter' | 'lab' | 'pharmacy';
  title: string;
  summary: string;
  provider: string;
  status: string;
  date: string;
};

export function usePatientHistory(nin: string, enabled = true) {
  const encountersQuery = useEncounters(nin, { page: 1, limit: 50 }, enabled);
  const labsQuery = useLabs(nin, { page: 1, limit: 50 }, enabled);
  const pharmacyQuery = usePharmacyRecords(nin, { page: 1, limit: 50 }, enabled);

  const history = useMemo<HistoryItem[]>(() => {
    const encounters = (encountersQuery.data?.rows ?? []).map((row) => ({
      id: `enc-${row.id}`,
      type: 'encounter' as const,
      title: row.visitType,
      summary: row.diagnosis,
      provider: row.provider,
      status: row.status,
      date: row.date,
    }));
    const labs = (labsQuery.data?.rows ?? []).map((row) => ({
      id: `lab-${row.id}`,
      type: 'lab' as const,
      title: row.testName,
      summary: row.interpretation,
      provider: row.facility,
      status: row.status,
      date: row.date,
    }));
    const pharmacy = (pharmacyQuery.data?.rows ?? []).map((row) => ({
      id: `pharm-${row.id}`,
      type: 'pharmacy' as const,
      title: row.medication,
      summary: row.dosage,
      provider: row.facility,
      status: row.status,
      date: row.date,
    }));
    return [...encounters, ...labs, ...pharmacy].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [encountersQuery.data?.rows, labsQuery.data?.rows, pharmacyQuery.data?.rows]);

  return {
    history,
    isLoading: encountersQuery.isLoading || labsQuery.isLoading || pharmacyQuery.isLoading,
    isError: encountersQuery.isError || labsQuery.isError || pharmacyQuery.isError,
    refetch: async () => {
      await Promise.all([encountersQuery.refetch(), labsQuery.refetch(), pharmacyQuery.refetch()]);
    },
  };
}
