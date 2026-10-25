import { installPrivacyProverHost } from './offscreenHost';

installPrivacyProverHost((kind) =>
  kind === 'main'
    ? new Worker(new URL('./worker.ts', import.meta.url))
    : new Worker(new URL('./subworker.ts', import.meta.url))
);
