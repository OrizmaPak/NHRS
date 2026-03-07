import { SmartSelect } from '@/components/data/SmartSelect';
import type { EncounterRow } from '@/api/hooks/useEncounters';

export function LinkedEncounterSelect({
  value,
  onChange,
  encounters,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  encounters: EncounterRow[];
}) {
  return (
    <SmartSelect
      value={value}
      onChange={(next) => onChange(next)}
      placeholder="Linked encounter (optional)"
      loadOptions={async (input) =>
        encounters
          .filter((encounter) => `${encounter.encounterId} ${encounter.visitType}`.toLowerCase().includes(input.toLowerCase()))
          .map((encounter) => ({
            value: encounter.id,
            label: `${encounter.encounterId} - ${encounter.visitType}`,
            description: encounter.date,
          }))
      }
    />
  );
}
