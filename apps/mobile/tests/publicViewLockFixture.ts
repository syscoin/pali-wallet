import { PublicViewLock } from '../src/core/publicViewLock.ts';

export function createTestPublicViewLock(initial: 'locked' | 'unlocked' = 'unlocked') {
  let marker = initial;
  const viewLock = new PublicViewLock({
    get: async () => marker,
    set: async value => { marker = value as typeof marker; },
  });
  const ready = viewLock.load();
  return { viewLock, ready, marker: () => marker };
}
