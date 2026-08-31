import { createFileRoute } from '@tanstack/react-router';

// Stub: f4 replaces the body with <HarnessList>.
function HarnessesIndexRoute() {
  return <h1>Harnesses</h1>;
}

export const Route = createFileRoute('/harnesses/')({ component: HarnessesIndexRoute });
