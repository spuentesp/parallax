import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { OrgLayout } from './routes/OrgLayout.js';
import { Orgs } from './routes/Orgs.js';
import { Service } from './routes/Service.js';
import { WorkspaceDetail } from './routes/WorkspaceDetail.js';
import { Workspaces } from './routes/Workspaces.js';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/workspaces" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'workspaces/:id', element: <WorkspaceDetail /> },
      { path: 'assessments', element: <Assessments /> },
      { path: 'assessments/:assessmentId', element: <Assessment /> },
      { path: 'orgs', element: <Orgs /> },
      {
        path: 'orgs/:orgId',
        element: <OrgLayout />,
        children: [{ path: 'services/:serviceId', element: <Service /> }],
      },
    ],
  },
]);
