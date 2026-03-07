export type ScopeType = 'platform' | 'organization' | 'state' | 'taskforce';

export type AppContext = {
  id: string;
  type: ScopeType;
  name: string;
  subtitle?: string;
  logoUrl?: string;
  themeScopeType: ScopeType;
  themeScopeId: string | null;
  permissions: string[];
};

export type UserProfile = {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName: string;
  email: string;
  phone?: string;
  roles: string[];
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
};

export type RefreshResponse = {
  accessToken: string;
  refreshToken?: string;
};
