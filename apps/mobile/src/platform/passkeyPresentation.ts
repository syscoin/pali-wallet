import { abortable } from '../../../../source/shared/boundedHttp.ts';
import { DeviceUnlockPrompt } from './deviceUnlockPrompt.ts';

/** Only public WebAuthn response bytes may wait for the OS sheet's focus handoff. */
export function createPasskeyPresentation(activity: ConstructorParameters<typeof DeviceUnlockPrompt>[0]) {
  const prompt = new DeviceUnlockPrompt(activity);
  return {
    isActive: (owner?: AbortSignal) => owner ? prompt.isActive(owner) : prompt.isAnyPromptActive(),
    run(owner: AbortSignal, request: () => Promise<string>): Promise<string> {
      return prompt.run(owner, async () => {
        const lifetime = new AbortController();
        let focused = true, resume: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
        const cancel = () => lifetime.abort();
        const remove = activity.subscribe(state => {
          if (state === 'background') cancel();
          if (state === 'blur') focused = false;
          if (state === 'focus') focused = true;
          if (focused && activity.state() === 'active') resume?.();
        });
        owner.addEventListener('abort', cancel, { once: true });
        try {
          if (owner.aborted) cancel();
          const response = await abortable(request(), lifetime.signal);
          if (activity.state() !== 'active' || !focused) {
            await abortable(new Promise<void>(resolve => {
              resume = resolve; timer = setTimeout(cancel, 1500);
              if (focused && activity.state() === 'active') resolve();
            }), lifetime.signal);
          }
          return response;
        } finally {
          if (timer) clearTimeout(timer);
          resume = undefined; owner.removeEventListener('abort', cancel); remove();
        }
      });
    },
  };
}
