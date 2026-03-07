import { mockContexts, mockThemes, mockUser } from '@/lib/mock-data';
import { resolveTheme } from '@/lib/theme';
import type { IdentityResponse } from '@/types/auth';
import type { EffectiveTheme, ScopeType } from '@/types/theme';

const wait = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchSession(): Promise<{ token: string }> {
  await wait();
  return {
    token: 'demo-session-token',
  };
}

export async function fetchIdentity(): Promise<IdentityResponse> {
  await wait(180);
  return {
    user: mockUser,
    roles: mockUser.roles,
    permissions: mockContexts[0]?.permissions ?? [],
    availableContexts: mockContexts,
    defaultContextId: mockContexts[0]?.id,
  };
}

export async function fetchEffectiveTheme(scopeType: ScopeType, scopeId: string | null): Promise<EffectiveTheme> {
  await wait(180);
  const platformTheme = mockThemes.find((theme) => theme.scopeType === 'platform');
  const tenantTheme = mockThemes.find((theme) => theme.scopeType === scopeType && theme.scopeId === scopeId);
  const parentTheme = tenantTheme?.parentThemeId
    ? mockThemes.find((theme) => theme.id === tenantTheme.parentThemeId)
    : undefined;

  return resolveTheme({
    platformTheme,
    parentTheme,
    tenantTheme,
  });
}

export async function switchContext(scopeType: ScopeType, scopeId: string | null): Promise<EffectiveTheme> {
  return fetchEffectiveTheme(scopeType, scopeId);
}
