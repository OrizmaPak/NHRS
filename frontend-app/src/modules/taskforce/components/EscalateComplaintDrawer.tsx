import type { EscalationValues } from '@/modules/taskforce/components/EscalationFormDrawer';
import { EscalationFormDrawer } from '@/modules/taskforce/components/EscalationFormDrawer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: EscalationValues) => Promise<void>;
};

const complaintUnits = [
  { value: 'state-governance-unit', label: 'State Governance Unit' },
  { value: 'national-governance-unit', label: 'National Governance Unit' },
];

export function EscalateComplaintDrawer({ open, onOpenChange, onSubmit }: Props) {
  return (
    <EscalationFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Escalate Complaint"
      onSubmit={onSubmit}
      units={complaintUnits}
    />
  );
}
