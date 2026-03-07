export type ApiError = {
  message: string;
  code: string;
  details?: Record<string, unknown>;
};

export type PaginatedResult<T> = {
  data: T[];
  page: number;
  limit: number;
  total: number;
};
