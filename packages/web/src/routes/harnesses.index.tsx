import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { HarnessList } from '../components/HarnessList';

function HarnessesIndexRoute() {
  const navigate = useNavigate();
  return (
    <HarnessList
      onOpen={(id) => {
        void navigate({ to: '/harnesses/$id', params: { id } });
      }}
    />
  );
}

export const Route = createFileRoute('/harnesses/')({ component: HarnessesIndexRoute });
