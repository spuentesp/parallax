import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/orgs" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [{ path: 'orgs', element: <div>orgs (stub)</div> }],
  },
]);
