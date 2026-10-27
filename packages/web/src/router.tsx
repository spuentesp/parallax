import type * as React from 'react';
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { LegacyAssessmentRedirect } from './routes/LegacyAssessmentRedirect.js';
import { OrgLayout } from './routes/OrgLayout.js';
import { Orgs } from './routes/Orgs.js';
import { Service } from './routes/Service.js';
import { WorkspaceDetail } from './routes/WorkspaceDetail.js';
import { Workspaces } from './routes/Workspaces.js';

// Sub-rutas desconocidas dentro de un org vuelven al hub del org, nunca al
// picker (spec: "redirect al hub del org, o /orgs si no hay org").
function OrgCatchAll(): React.ReactElement {
  const { orgId } = useParams();
  return <Navigate to={`/orgs/${orgId ?? ''}`} replace />;
}

export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/orgs" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'workspaces/:id', element: <WorkspaceDetail /> },
      { path: 'orgs', element: <Orgs /> },
      { path: 'orgs/:orgId', element: <OrgLayout /> },
      { path: 'orgs/:orgId/services/:serviceId', element: <Service /> },
      { path: 'orgs/:orgId/assessments', element: <Assessments /> },
      { path: 'orgs/:orgId/assessments/:assessmentId', element: <Assessment /> },
      { path: 'orgs/:orgId/*', element: <OrgCatchAll /> },
      // Compatibilidad: los deep links viejos siguen vivos.
      { path: 'assessments', element: <Navigate to="/orgs" replace /> },
      { path: 'assessments/:assessmentId', element: <LegacyAssessmentRedirect /> },
      { path: '*', element: <Navigate to="/orgs" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
