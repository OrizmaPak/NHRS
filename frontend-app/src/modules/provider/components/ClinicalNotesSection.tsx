type TextareaProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  error?: string;
};

function NotesField({ value, onChange, label, placeholder, error }: TextareaProps) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function ClinicalNotesSection({
  presentingComplaint,
  onPresentingComplaintChange,
  historyNotes,
  onHistoryNotesChange,
  diagnosis,
  onDiagnosisChange,
  clinicianNotes,
  onClinicianNotesChange,
  followUpRecommendation,
  onFollowUpRecommendationChange,
  errors = {},
}: {
  presentingComplaint: string;
  onPresentingComplaintChange: (value: string) => void;
  historyNotes: string;
  onHistoryNotesChange: (value: string) => void;
  diagnosis: string;
  onDiagnosisChange: (value: string) => void;
  clinicianNotes: string;
  onClinicianNotesChange: (value: string) => void;
  followUpRecommendation: string;
  onFollowUpRecommendationChange: (value: string) => void;
  errors?: Record<string, string | undefined>;
}) {
  return (
    <div className="space-y-4">
      <NotesField
        label="Presenting Complaint"
        value={presentingComplaint}
        onChange={onPresentingComplaintChange}
        placeholder="Presenting complaint..."
        error={errors.presentingComplaint}
      />
      <NotesField
        label="History Notes"
        value={historyNotes}
        onChange={onHistoryNotesChange}
        placeholder="Clinical history notes..."
        error={errors.historyNotes}
      />
      <NotesField
        label="Diagnosis"
        value={diagnosis}
        onChange={onDiagnosisChange}
        placeholder="Diagnosis summary..."
        error={errors.diagnosis}
      />
      <NotesField
        label="Clinician Notes"
        value={clinicianNotes}
        onChange={onClinicianNotesChange}
        placeholder="Additional clinician notes..."
        error={errors.clinicianNotes}
      />
      <NotesField
        label="Follow-up Recommendation"
        value={followUpRecommendation}
        onChange={onFollowUpRecommendationChange}
        placeholder="Follow-up recommendation..."
        error={errors.followUpRecommendation}
      />
    </div>
  );
}
