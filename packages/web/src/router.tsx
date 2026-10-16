import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { LegacyAssessmentRedirect } from './routes/LegacyAssessmentRedirect.js';
import { OrgLayout } from './routes/OrgLayout.js';
import { Orgs } from './routes/Orgs.js';
import { Service } from './routes/Service.js';
import { WorkspaceDetail } from './routes/WorkspaceDetail.js';
import { Workspaces } from './routes/Workspaces.js';

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/orgs" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'workspaces/:id', element: <WorkspaceDetail /> },
      { path: 'orgs', element: <Orgs /> },
      {
        path: 'orgs/:orgId',
        element: <OrgLayout />,
        children: [{ path: 'services/:serviceId', element: <Service /> }],
      },
      { path: 'orgs/:orgId/assessments', element: <Assessments /> },
      { path: 'orgs/:orgId/assessments/:assessmentId', element: <Assessment /> },
      // Compatibilidad: los deep links viejos siguen vivos.
      { path: 'assessments', element: <Navigate to="/orgs" replace /> },
      { path: 'assessments/:assessmentId', element: <LegacyAssessmentRedirect /> },
      { path: '*', element: <Navigate to="/orgs" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
