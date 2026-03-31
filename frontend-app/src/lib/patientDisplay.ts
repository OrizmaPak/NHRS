function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePatientNameCandidate(value: unknown, fallbackNin?: string): string {
  const text = asText(value);
  if (!text) return '';

  const digits = text.replace(/\D/g, '');
  const fallbackDigits = asText(fallbackNin).replace(/\D/g, '');
  const isSyntheticNinLabel =
    text === fallbackDigits
    || (/^NIN\b/i.test(text) && digits.length === 11)
    || Boolean(fallbackDigits && digits === fallbackDigits);

  return isSyntheticNinLabel ? '' : text;
}

export function resolvePatientDisplayName(source: Record<string, unknown>, fallbackNin?: string): string {
  const firstName = asText(source.firstName);
  const otherName = asText(source.otherName);
  const lastName = asText(source.lastName);
  const nameParts = [firstName, otherName, lastName].filter(Boolean);
  const combinedName = nameParts.join(' ').trim();
  const strongCombinedName = nameParts.length >= 2 ? combinedName : '';

  return (
    strongCombinedName
    || normalizePatientNameCandidate(source.displayName, fallbackNin)
    || normalizePatientNameCandidate(source.fullName, fallbackNin)
    || normalizePatientNameCandidate(source.name, fallbackNin)
    || combinedName
    || (fallbackNin ? `NIN ${fallbackNin}` : '')
    || 'Patient'
  );
}
