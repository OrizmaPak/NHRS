import { API_BASE_URL, CONTEXT_STORAGE_KEY } from '@/lib/constants';
import { clearSessionTokens, getAccessToken, getRefreshToken, setSessionTokens } from '@/lib/sessionStorage';
import { endpoints } from '@/api/endpoints';

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
  if (!raw) return {};

  return {
    'x-active-context-id': raw,
  };
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
};

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { query, body, headers, skipAuth, skipRefresh, ...rest } = options;
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
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      window.dispatchEvent(new CustomEvent('nhrs:api-error', { detail: { status: response.status } }));
    }
    const payload = await parseJson<{ message?: string; code?: string; details?: Record<string, unknown> }>(response);
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
