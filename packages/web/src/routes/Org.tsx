import type * as React from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { ServiceMap } from '../components/ServiceMap.js';

export function Org(): React.ReactElement {
  const { orgId } = useParams();
  return (
    <section>
      <h1>Organization {orgId}</h1>
      <ServiceMap />
      <nav style={{ marginTop: 16 }}>
        <Link to="assessments">Assessments</Link>
      </nav>
      <Outlet />
    </section>
  );
}
