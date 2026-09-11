import { Navigate, useOutletContext } from 'react-router';
import type { MeResponse } from '@platform/shared/dto';

/** Lands each role on its home: finance on the reports, everyone else on the floor plan. */
export default function IndexRoute() {
  const me = useOutletContext<MeResponse>();
  return (
    <Navigate to={me.user.role === 'FINANCE' ? '/reports/energy-cost' : '/floors/1'} replace />
  );
}
