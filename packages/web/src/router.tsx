import type * as React from 'react';
import type { RouteObject } from 'react-router-dom';
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { AuthGate } from './components/AuthGate.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { Contracts } from './routes/Contracts.js';
import { LegacyAssessmentRedirect } from './routes/LegacyAssessmentRedirect.js';
import { OrgLayout } from './routes/OrgLayout.js';
import { Home, ToWorkspaceList, WorkspaceRedirect } from './routes/Redirects.js';
import { Repos } from './routes/Repos.js';
import { Service } from './routes/Service.js';
import { WorkspaceLayout } from './routes/WorkspaceLayout.js';
import { Workspaces } from './routes/Workspaces.js';

// Sub-rutas desconocidas dentro de un org vuelven al hub del org, nunca al
// picker (spec: "redirect al hub del org, o /orgs si no hay org").
function OrgCatchAll(): React.ReactElement {
  const { orgId } = useParams();
  return <Navigate to={`/orgs/${orgId ?? ''}`} replace />;
}

// Un workspace tiene UN árbol de URL: /orgs/:orgId (mapa), /repos, /contracts y
// /assessments. La lista de workspaces es /orgs. Las rutas viejas redirigen.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: (
      <AuthGate>
        <AppShell />
      </AuthGate>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: 'orgs', element: <Workspaces /> },
      {
        path: 'orgs/:orgId',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <OrgLayout /> },
          { path: 'repos', element: <Repos /> },
          { path: 'contracts', element: <Contracts /> },
          { path: 'services/:serviceId', element: <Service /> },
          { path: 'assessments', element: <Assessments /> },
          { path: 'assessments/:assessmentId', element: <Assessment /> },
          { path: '*', element: <OrgCatchAll /> },
        ],
      },
      // Compatibilidad: los enlaces viejos siguen vivos.
      { path: 'workspaces', element: <ToWorkspaceList /> },
      { path: 'workspaces/:id', element: <WorkspaceRedirect /> },
      { path: 'assessments', element: <Navigate to="/orgs" replace /> },
      { path: 'assessments/:assessmentId', element: <LegacyAssessmentRedirect /> },
      { path: '*', element: <Home /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
