import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { Assessment } from './routes/Assessment.js';
import { Assessments } from './routes/Assessments.js';
import { Org } from './routes/Org.js';
import { Orgs } from './routes/Orgs.js';
import { Proposal } from './routes/Proposal.js';
import { Workspaces } from './routes/Workspaces.js';
import { Service } from './routes/Service.js';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/orgs" replace /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'orgs', element: <Orgs /> },
      {
        path: 'orgs/:orgId',
        element: <Org />,
        children: [
          { path: 'services/:serviceId', element: <Service /> },
          { path: 'assessments', element: <Assessments /> },
          { path: 'assessments/:assessmentId', element: <Assessment /> },
          { path: 'proposals/:proposalId', element: <Proposal /> },
        ],
      },
    ],
  },
]);
