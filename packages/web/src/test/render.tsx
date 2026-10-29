import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Render con el stack real de datos: los tests pasan por los hooks y el
 * cliente HTTP de verdad (interceptado por MSW en el borde). `retry: false`
 * mantiene rápidos los caminos de error.
 *
 * Por defecto la sesión ya está iniciada (el resultado de `/api/whoami` está en
 * la caché), para que los tests de pantallas no pasen por la puerta de acceso.
 * Los tests de la puerta usan `{ signedIn: false }` y el flujo real.
 */
export function renderWithQuery(
  ui: ReactElement,
  opts: { signedIn?: boolean | { readOnly: boolean } } = {},
): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = opts.signedIn ?? true;
  if (session) {
    const readOnly = typeof session === 'object' ? session.readOnly : false;
    client.setQueryData(['whoami'], {
      orgId: 'acme',
      scopes: readOnly ? ['read'] : ['read', 'write'],
      readOnly,
    });
  }
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
