import type { NotificationSnapshot } from './types.ts';

export function startNotificationLifecycle(service: {
  load(): Promise<void>; run(signal: AbortSignal): Promise<void>;
  getSnapshot(): NotificationSnapshot; subscribe(listener: () => void): () => void;
}, activity: {
  current(): string; subscribe(listener: (state: string) => void): () => void;
  everyMinute(listener: () => void): () => void;
}): () => void {
  let closed = false, loaded = false, active = activity.current() === 'active';
  let epoch = new AbortController();
  let stopTimer: (() => void) | undefined;
  const eligible = () => loaded && active && !closed && (service.getSnapshot().status === 'unavailable' ||
    service.getSnapshot().status === 'ready' && service.getSnapshot().enabledScopeIds.length > 0);
  const poll = () => {
    if (!eligible()) return;
    const started = epoch;
    void (async () => {
      if (service.getSnapshot().status !== 'ready') await service.load();
      if (started !== epoch || !eligible() || service.getSnapshot().status !== 'ready') return;
      await service.run(started.signal);
    })().catch(() => undefined).finally(() => {
      // A resume can coalesce onto the just-aborted foreground run. Once that
      // run drains, check once in the new active generation.
      if (started !== epoch && eligible()) poll();
    });
  };
  const reconcile = () => {
    if (eligible()) { if (!stopTimer) stopTimer = activity.everyMinute(poll); }
    else { stopTimer?.(); stopTimer = undefined; }
  };
  const unsubscribe = service.subscribe(reconcile);
  const unsubscribeActivity = activity.subscribe((state) => {
    const next = state === 'active';
    if (next === active) return;
    active = next; epoch.abort(); epoch = new AbortController();
    reconcile(); if (active) poll();
  });
  void service.load().catch(() => undefined).finally(() => {
    if (!closed) { loaded = true; reconcile(); if (service.getSnapshot().status === 'ready') poll(); }
  });
  return () => { closed = true; epoch.abort(); stopTimer?.(); stopTimer = undefined; unsubscribe(); unsubscribeActivity(); };
}
