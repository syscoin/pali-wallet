/** Keeps only an expected OS permission dialog distinct from real backgrounding. */
export function createNotificationPermissionPresentation(activity: {
  current(): string;
  subscribe(listener: (state: string) => void): () => void;
}) {
  let active = false;
  return {
    isActive: () => active,
    async run<T>(request: () => Promise<T>): Promise<T> {
      if (active || activity.current() !== 'active') throw Error('Permission request unavailable');
      active = true;
      let backgrounded = false;
      let returned: (() => void) | undefined;
      let remove: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        remove = activity.subscribe(state => {
          if (state === 'background') backgrounded = true;
          if (state === 'active' || backgrounded) returned?.();
        });
        const value = await request();
        if (!backgrounded && activity.current() !== 'active') {
          await new Promise<void>(resolve => { returned = resolve; timer = setTimeout(resolve, 1500); });
        }
        if (backgrounded || activity.current() !== 'active') throw Error('Permission request interrupted');
        return value;
      } finally {
        if (timer) clearTimeout(timer);
        returned = undefined; active = false; remove?.();
      }
    },
  };
}
