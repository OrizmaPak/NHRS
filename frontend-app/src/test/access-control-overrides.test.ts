import { describe, expect, it } from 'vitest';
import { overrideTargetsScope } from '@/api/hooks/useAccessControl';

describe('overrideTargetsScope', () => {
  it('matches organization overrides only for organization saves', () => {
    expect(overrideTargetsScope({}, { scopeType: 'organization' })).toBe(true);
    expect(overrideTargetsScope({}, { scopeType: 'institution', institutionId: 'inst-1' })).toBe(false);
    expect(overrideTargetsScope({}, { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' })).toBe(false);
  });

  it('matches only the same institution scope', () => {
    expect(
      overrideTargetsScope(
        { scopeType: 'institution', institutionId: 'inst-1' },
        { scopeType: 'institution', institutionId: 'inst-1' },
      ),
    ).toBe(true);

    expect(
      overrideTargetsScope(
        { scopeType: 'institution', institutionId: 'inst-1' },
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' },
      ),
    ).toBe(false);

    expect(
      overrideTargetsScope(
        { scopeType: 'institution', institutionId: 'inst-1' },
        { scopeType: 'institution', institutionId: 'inst-2' },
      ),
    ).toBe(false);
  });

  it('matches only the same branch scope', () => {
    expect(
      overrideTargetsScope(
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' },
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' },
      ),
    ).toBe(true);

    expect(
      overrideTargetsScope(
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' },
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-2' },
      ),
    ).toBe(false);

    expect(
      overrideTargetsScope(
        { scopeType: 'branch', institutionId: 'inst-1', branchId: 'branch-1' },
        { scopeType: 'institution', institutionId: 'inst-1' },
      ),
    ).toBe(false);
  });
});
