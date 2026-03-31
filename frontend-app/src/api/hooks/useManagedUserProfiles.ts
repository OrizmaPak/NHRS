import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';

export type ManagedUserSearchResult = {
  userId: string;
  nin: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  profileStatus: string | null;
};

export type ManagedUserProfile = {
  userId: string;
  nin: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  otherName: string | null;
  dob: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  professionTypes: string[];
  profileStatus: string | null;
  address: {
    country: string | null;
    state: string | null;
    lga: string | null;
    city: string | null;
    line1: string | null;
    line2: string | null;
    postalCode: string | null;
  } | null;
  preferences: {
    notificationChannels: string[];
    language: string | null;
  } | null;
};

export type ManagedUserProfileInput = {
  displayName: string;
  firstName: string;
  lastName: string;
  otherName: string;
  dob: string;
  gender: string;
  phone: string;
  email: string;
  professionTypes: string[];
  address: {
    country: string;
    state: string;
    lga: string;
    city: string;
    line1: string;
    line2: string;
    postalCode: string;
  };
  preferences: {
    notificationChannels: string[];
    language: string;
  };
};

export type ManagedUserProfilePatch = Partial<Omit<ManagedUserProfileInput, 'address' | 'preferences'>> & {
  address?: Partial<ManagedUserProfileInput['address']>;
  preferences?: Partial<ManagedUserProfileInput['preferences']>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function toSearchResult(raw: unknown): ManagedUserSearchResult | null {
  const row = asObject(raw);
  if (!row) return null;
  const userId = asString(row.userId);
  if (!userId) return null;
  return {
    userId,
    nin: asString(row.nin),
    displayName: asString(row.displayName) || [asString(row.firstName), asString(row.lastName)].filter(Boolean).join(' ') || userId,
    firstName: asString(row.firstName),
    lastName: asString(row.lastName),
    phone: asString(row.phone),
    email: asString(row.email),
    profileStatus: asString(row.profileStatus),
  };
}

function toManagedProfile(raw: unknown): ManagedUserProfile | null {
  const row = asObject(raw);
  if (!row) return null;
  const userId = asString(row.userId);
  if (!userId) return null;
  const address = asObject(row.address);
  const preferences = asObject(row.preferences);
  return {
    userId,
    nin: asString(row.nin),
    displayName: asString(row.displayName),
    firstName: asString(row.firstName),
    lastName: asString(row.lastName),
    otherName: asString(row.otherName),
    dob: asString(row.dob),
    gender: asString(row.gender),
    phone: asString(row.phone),
    email: asString(row.email),
    professionTypes: Array.isArray(row.professionTypes) ? row.professionTypes.map((item) => String(item)).filter(Boolean) : [],
    profileStatus: asString(row.profileStatus),
    address: address ? {
      country: asString(address.country),
      state: asString(address.state),
      lga: asString(address.lga),
      city: asString(address.city),
      line1: asString(address.line1),
      line2: asString(address.line2),
      postalCode: asString(address.postalCode),
    } : null,
    preferences: preferences ? {
      notificationChannels: Array.isArray(preferences.notificationChannels)
        ? preferences.notificationChannels.map((item) => String(item)).filter(Boolean)
        : [],
      language: asString(preferences.language),
    } : null,
  };
}

export async function searchManagedUserProfiles(search: string, organizationId?: string): Promise<ManagedUserSearchResult[]> {
  const term = search.trim();
  if (!term) return [];
  const digits = term.replace(/\D/g, '');
  const query: Record<string, string | number | undefined> = {
    limit: 12,
    organizationId: organizationId || undefined,
  };

  if (term.includes('@')) {
    query.email = term;
  } else if (digits.length >= 7 && digits === term.replace(/\s/g, '')) {
    if (digits.length === 11) query.nin = digits;
    else query.phone = term;
  } else if (term) {
    if (term.length < 2) return [];
    query.name = term;
  }

  const response = await apiClient.get<Record<string, unknown>>(endpoints.profile.search, { query });
  const items = Array.isArray(response.items) ? response.items : [];
  return items.map(toSearchResult).filter((entry): entry is ManagedUserSearchResult => Boolean(entry));
}

export function useManagedUserProfile(userId?: string, organizationId?: string) {
  return useQuery({
    queryKey: ['profile', 'managed', userId ?? 'none', organizationId ?? 'none'],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return null;
      const response = await apiClient.get<Record<string, unknown>>(endpoints.profile.byUserId(userId), {
        query: { organizationId: organizationId || undefined },
      });
      return toManagedProfile(response.profile);
    },
  });
}

export function useUpdateManagedUserProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: string; organizationId?: string; values: ManagedUserProfilePatch }) => {
      const { userId, organizationId, values } = payload;
      return apiClient.patch(endpoints.profile.updateByUserId(userId), values, {
        query: { organizationId: organizationId || undefined },
      });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['profile', 'managed', variables.userId] });
    },
  });
}
