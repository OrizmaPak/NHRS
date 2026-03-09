import { API_BASE_URL, CONTEXT_STORAGE_KEY } from '@/lib/constants';
import { clearSessionTokens, getAccessToken, getRefreshToken, setSessionTokens } from '@/lib/sessionStorage';
import { endpoints } from '@/api/endpoints';
import { useContextStore } from '@/stores/contextStore';

export class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

function buildQuery(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function getContextHeaders(): Record<string, string> {
  const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
  const activeContext = useContextStore.getState().activeContext;
  const headers: Record<string, string> = {};

  if (raw) {
    headers['x-active-context-id'] = raw;
  }

  if (activeContext?.type === 'organization') {
    const orgId = activeContext.organizationId || activeContext.id;
    if (orgId) {
      headers['x-org-id'] = orgId;
    }
    if (activeContext.branchId) {
      headers['x-branch-id'] = activeContext.branchId;
    }
  }

  return headers;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return (await response.json()) as T;
}

async function refreshTokenRequest(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const response = await fetch(`${API_BASE_URL}${endpoints.auth.refresh}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      window.dispatchEvent(
        new CustomEvent('nhrs:api-error', { detail: { status: response.status, forceLogout: true } }),
      );
    }
    clearSessionTokens();
    return null;
  }

  const payload = (await response.json()) as { accessToken?: string; refreshToken?: string };
  if (!payload.accessToken) {
    clearSessionTokens();
    return null;
  }

  setSessionTokens({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken ?? refreshToken,
  });

  return payload.accessToken;
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  query?: QueryParams;
  body?: unknown;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  suppressGlobalErrors?: boolean;
};

function extractDeniedPermission(details?: Record<string, unknown>): string | undefined {
  if (!details || typeof details !== 'object') return undefined;

  const direct = details.permission ?? details.permissionKey ?? details.requiredPermission;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }

  const list = details.permissions ?? details.requiredPermissions;
  if (Array.isArray(list)) {
    const keys = list.map((entry) => String(entry ?? '').trim()).filter(Boolean);
    if (keys.length === 1) return keys[0];
    if (keys.length > 1) return `Any of: ${keys.join(', ')}`;
  }

  return undefined;
}

function extractPermissionFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const patterns = [
    /permission(?:\s+key)?\s*[:=]\s*([a-z0-9*._:-]+)/i,
    /requires?\s+permission\s+([a-z0-9*._:-]+)/i,
    /missing\s+permission\s+([a-z0-9*._:-]+)/i,
    /denied\s+permission\s+([a-z0-9*._:-]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, headers, skipAuth, skipRefresh, suppressGlobalErrors, ...rest } = options;
  const accessToken = getAccessToken();
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const requestHeaders: Record<string, string> = {
    ...getContextHeaders(),
    ...(skipAuth || !accessToken ? {} : { Authorization: `Bearer ${accessToken}` }),
    ...(headers as Record<string, string> | undefined),
  };
  if (!isFormData) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}${buildQuery(query)}`, {
    method,
    ...rest,
    headers: requestHeaders,
    body: body === undefined ? undefined : (isFormData ? (body as FormData) : JSON.stringify(body)),
  });

  if (response.status === 401 && !skipAuth && !skipRefresh) {
    const nextAccessToken = await refreshTokenRequest();
    if (nextAccessToken) {
      return request<T>(method, path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) {
    const payload = await parseJson<{ message?: string; code?: string; details?: Record<string, unknown> }>(response);
    const deniedPermission =
      extractDeniedPermission(payload?.details)
      ?? extractPermissionFromText(payload?.message)
      ?? extractPermissionFromText(payload?.code);

    if (!suppressGlobalErrors && (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500)) {
      window.dispatchEvent(
        new CustomEvent('nhrs:api-error', {
          detail: {
            status: response.status,
            message: payload?.message,
            code: payload?.code,
            deniedPermission,
          },
        }),
      );
    }

    throw new ApiClientError(
      payload?.message ?? `Request failed with status ${response.status}`,
      response.status,
      payload?.code,
      payload?.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await parseJson<T>(response);
  return (data ?? ({} as T)) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) => request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) => request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('DELETE', path, options),
};
