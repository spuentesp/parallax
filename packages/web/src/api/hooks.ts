import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiClient, ApiEndpointNotImplemented } from './client.js';

// Token source: localStorage (set by user), URL hash (?token=...), or empty.
function getToken(): string | null {
  const fromStorage = localStorage.getItem('parallax_token');
  if (fromStorage) return fromStorage;
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}
const token = getToken();
if (token) localStorage.setItem('parallax_token', token);
const client = new ApiClient(token ? { token } : {});

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
