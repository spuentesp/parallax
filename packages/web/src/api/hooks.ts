import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiClient, ApiEndpointNotImplemented } from './client.js';

const client = new ApiClient();

export function useOrgs() {
  return useQuery({
    queryKey: ['orgs'],
    queryFn: () => client.get<{ orgs: unknown[] }>('/api/orgs'),
  });
}

export function useAssessment(id: string | null) {
  return useQuery({
    queryKey: ['assessment', id],
    queryFn: () => client.get(`/api/assessments/${id}`),
    enabled: id != null,
    retry: (count, err) => {
      if (err instanceof ApiEndpointNotImplemented) return false;
      return count < 2;
    },
  });
}

export function useCreateAssessment() {
  return useMutation({
    mutationFn: (body: unknown) => client.post('/api/assessments', body),
  });
}
