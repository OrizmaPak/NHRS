import type { EscalationValues } from '@/modules/taskforce/components/EscalationFormDrawer';
import { EscalationFormDrawer } from '@/modules/taskforce/components/EscalationFormDrawer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: EscalationValues) => Promise<void>;
};

const caseUnits = [
  { value: 'state-taskforce-ops', label: 'State Taskforce Operations' },
  { value: 'national-taskforce-command', label: 'National Taskforce Command' },
];

export function EscalateCaseDrawer({ open, onOpenChange, onSubmit }: Props) {
  return (
    <EscalationFormDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Escalate Case"
      onSubmit={onSubmit}
      units={caseUnits}
    />
  );
}
