import { describe, expect, it } from 'vitest';
import { resolvePatientDisplayName } from '@/lib/patientDisplay';

describe('resolvePatientDisplayName', () => {
  it('prefers real name parts over synthetic NIN display labels', () => {
    expect(resolvePatientDisplayName({
      displayName: 'NIN 90000000014',
      firstName: 'Ngozi',
      otherName: 'Ada',
      lastName: 'Okafor',
    }, '90000000014')).toBe('Ngozi Ada Okafor');
  });

  it('still falls back to the NIN label when no real name exists', () => {
    expect(resolvePatientDisplayName({
      displayName: 'NIN 90000000015',
    }, '90000000015')).toBe('NIN 90000000015');
  });
});
