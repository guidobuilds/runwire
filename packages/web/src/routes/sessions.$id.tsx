import { createFileRoute } from '@tanstack/react-router';
import { SessionDetail } from '../components/session-detail/SessionDetail';

function SessionDetailRoute() {
  const { id } = Route.useParams();
  return <SessionDetail id={id} />;
}

export const Route = createFileRoute('/sessions/$id')({ component: SessionDetailRoute });
