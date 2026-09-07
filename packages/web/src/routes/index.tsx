import { createFileRoute, redirect } from '@tanstack/react-router';

// f6: home is /sessions, not /. This route only ever redirects there.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/sessions' });
  },
});
