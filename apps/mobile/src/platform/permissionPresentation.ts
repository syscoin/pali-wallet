/** Keeps only an expected OS permission dialog distinct from real backgrounding. */
export function createPermissionPresentation(activity: {
  current(): string;
  subscribe(listener: (state: string) => void): () => void;
}) {
  let active: { backgrounded: boolean } | null = null;
  return {
    isActive: () => active !== null && !active.backgrounded,
    async run<T>(request: () => Promise<T>): Promise<T> {
      if (active || activity.current() !== 'active') throw Error('Permission request unavailable');
      const current = { backgrounded: false };
      active = current;
      let returned: (() => void) | undefined;
      let remove: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        remove = activity.subscribe(state => {
          if (state === 'background') current.backgrounded = true;
          if (state === 'active' || current.backgrounded) returned?.();
        });
        const value = await request();
        if (!current.backgrounded && activity.current() !== 'active') {
          await new Promise<void>(resolve => { returned = resolve; timer = setTimeout(resolve, 1500); });
        }
        if (current.backgrounded || activity.current() !== 'active') throw Error('Permission request interrupted');
        return value;
      } finally {
        if (timer) clearTimeout(timer);
        returned = undefined; if (active === current) active = null; remove?.();
      }
    },
  };
}
