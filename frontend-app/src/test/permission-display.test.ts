import { describe, expect, it } from 'vitest';
import { getPermissionDisplayMeta } from '@/lib/interfacePermissions';

describe('getPermissionDisplayMeta', () => {
  it('prefers a single mapped interface label as the primary title', () => {
    const meta = getPermissionDisplayMeta({
      key: 'profile.user.update',
      module: 'settings',
      description: 'Access staff user settings interface',
    });

    expect(meta.title).toBe('User Settings');
    expect(meta.groupLabel).toBe('Settings');
    expect(meta.interfaceSummary).toContain('User Settings');
  });

  it('falls back to a readable description for custom permissions', () => {
    const meta = getPermissionDisplayMeta({
      key: 'records.read',
      module: 'records',
      description: 'Read patient records',
    });

    expect(meta.title).toBe('Read patient records');
    expect(meta.groupLabel).toBe('Records');
    expect(meta.actionLabel).toBe('View');
  });

  it('uses navigation-friendly group labels for taskforce permissions', () => {
    const meta = getPermissionDisplayMeta({
      key: 'audit.read',
      module: 'governance',
      description: 'Access governance audit interface',
    });

    expect(meta.groupLabel).toBe('Taskforce');
  });
});
