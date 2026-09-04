import { adapterContract } from './contract';
import { createFakeAdapter } from './fake-adapter';

adapterContract({
  adapter: createFakeAdapter(),
  malformedSessionId: 'fake:diagnosed',
});
