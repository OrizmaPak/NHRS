import { describe, expect, it } from 'vitest';
import { getPermissionDisplayMeta } from '@/lib/interfacePermissions';

describe('getPermissionDisplayMeta', () => {
  it('prefers a single mapped interface label as the primary title', () => {
    const meta = getPermissionDisplayMeta({
      key: 'profile.user.update',
      module: 'settings',
      description: 'Access profile management interface',
    });

    expect(meta.title).toBe('Profile Management');
    expect(meta.groupLabel).toBe('Core');
    expect(meta.interfaceSummary).toContain('Profile Management');
  });

  it('falls back to a readable description for custom permissions', () => {
    const meta = getPermissionDisplayMeta({
      key: 'records.read',
      module: 'records',
      description: 'Read patient records',
    });

    expect(meta.title).toBe('Read patient records');
    expect(meta.groupLabel).toBe('Provider');
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

  it('maps provider submodules into the Provider navigation section', () => {
    const meta = getPermissionDisplayMeta({
      key: 'labs.read',
      module: 'labs',
      description: 'Access labs interface',
    });

    expect(meta.groupLabel).toBe('Provider');
  });

  it('maps organization management permissions into Administration', () => {
    const meta = getPermissionDisplayMeta({
      key: 'org.member.read',
      module: 'organization',
      description: 'Access organization staff interface',
    });

    expect(meta.groupLabel).toBe('Administration');
  });

  it('maps the providers module alias into Administration', () => {
    const meta = getPermissionDisplayMeta({
      key: 'org.manage',
      module: 'providers',
      description: 'Manage organization',
    });

    expect(meta.groupLabel).toBe('Administration');
  });

  it('returns layman-friendly helper text for known system permissions', () => {
    const meta = getPermissionDisplayMeta({
      key: 'org.manage',
      module: 'providers',
      description: 'Manage organization',
    });

    expect(meta.helperText).toBe('When this is turned on, the user can create, view, update, and remove organization records on the platform.');
  });
});
