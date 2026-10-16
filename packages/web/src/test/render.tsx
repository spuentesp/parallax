import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Render con el stack real de datos: los tests pasan por los hooks y el
 * cliente HTTP de verdad (interceptado por MSW en el borde). `retry: false`
 * mantiene rápidos los caminos de error.
 */
export function renderWithQuery(ui: ReactElement): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
