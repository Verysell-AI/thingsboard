import { useQuery } from '@tanstack/react-query';
import { MeResponseSchema, type MeResponse } from '@platform/shared/dto';
import { api } from './api';
import { isAuthenticated } from './auth';

export const ME_QUERY_KEY = ['me'] as const;

export function fetchMe(): Promise<MeResponse> {
  return api.get('/me', MeResponseSchema);
}

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    enabled: isAuthenticated(),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
