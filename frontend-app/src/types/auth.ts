export type ScopeType = 'public' | 'platform' | 'organization' | 'state' | 'taskforce';
export type ThemeScopeType = 'platform' | 'organization' | 'state' | 'taskforce';

export type AppContext = {
  id: string;
  type: ScopeType;
  name: string;
  subtitle?: string;
  logoUrl?: string;
  themeScopeType: ThemeScopeType;
  themeScopeId: string | null;
  permissions: string[];
  organizationId?: string;
  branchId?: string;
};

export type UserProfile = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string;
  phone?: string;
  roles: string[];
  requiresPasswordChange?: boolean;
};

export type IdentityResponse = {
  user: UserProfile;
  roles: string[];
  permissions: string[];
  availableContexts: AppContext[];
  defaultContextId?: string;
};

export type LoginPayload = {
  method: 'nin' | 'email' | 'phone';
  nin?: string;
  email?: string;
  phone?: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user?: UserProfile;
  requiresPasswordChange?: boolean;
};

export type RefreshResponse = {
  accessToken: string;
  refreshToken?: string;
};
