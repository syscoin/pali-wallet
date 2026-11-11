import type { createBrowserLocalPasskeyStorage } from './browserLocalPasskeyStorage';
import { createDeviceUnlockEnrollment } from './deviceUnlockEnrollment';
import { createLocalPasskeyBroker } from './localPasskeyBroker';
import { createLocalPasskeyCredentialPort } from './localPasskeyCredential';
import {
  checkLocalPasskeyOwner,
  localPasskeyError,
  type LocalPasskeyController,
} from './localPasskeyTypes';

export type LocalPasskeyEnrollment = ReturnType<
  typeof createDeviceUnlockEnrollment
>;
export type LocalPasskeyAuthority = Readonly<{
  assertCurrent(): void;
  signal: AbortSignal;
}>;

/** One trusted document, with SDK authentication and its mutex owned by the wallet. */
export function createOwnedLocalPasskeyController(
  ports: Readonly<{
    authority: LocalPasskeyAuthority;
    crypto: Pick<Crypto, 'subtle' | 'getRandomValues'>;
    disable(
      action: () => Promise<void>,
      password: string,
      assertCurrent: () => void
    ): Promise<void>;
    issue(
      enrollment: LocalPasskeyEnrollment,
      password: string,
      assertCurrent: () => void
    ): Promise<boolean>;
    now(): number;
    onDispose(): void;
    origin: string;
    randomId(): string;
    resume(
      enrollment: LocalPasskeyEnrollment,
      assertCurrent: () => void
    ): Promise<boolean>;
    storage: ReturnType<typeof createBrowserLocalPasskeyStorage>;
    wallTime(): number;
  }>
): LocalPasskeyController {
  const broker = createLocalPasskeyBroker(ports);
  let disposed = false,
    busy = false;
  const pending = new Set<Promise<unknown>>();
  const check = () => {
    if (disposed || ports.authority.signal.aborted) throw localPasskeyError();
    checkLocalPasskeyOwner(ports.authority.assertCurrent);
    if (disposed || ports.authority.signal.aborted) throw localPasskeyError();
  };
  const password = (value: string) => {
    if (typeof value !== 'string' || !value || value.length > 1024)
      throw localPasskeyError();
    return value;
  };
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    return work.finally(() => pending.delete(work));
  };
  const begin = (kind: 'issue' | 'resume', secret: string | null) => {
    check();
    if (busy) throw localPasskeyError();
    busy = true;
    try {
      return broker
        .begin(
          (ceremonies, assertBroker) =>
            track(
              (async () => {
                const guard = () => {
                  check();
                  checkLocalPasskeyOwner(assertBroker);
                };
                try {
                  guard();
                  const enrollment = createDeviceUnlockEnrollment({
                    credentials: createLocalPasskeyCredentialPort({
                      ceremonies,
                      crypto: ports.crypto,
                      origin: ports.origin,
                      storage: ports.storage.credentials,
                    }),
                    enrollment: ports.storage.enrollment,
                    randomId: ports.randomId,
                  });
                  return kind === 'issue'
                    ? await ports.issue(enrollment, secret!, guard)
                    : await ports.resume(enrollment, guard);
                } finally {
                  busy = false;
                }
              })()
            ),
          check
        )
        .catch((error) => {
          busy = false;
          throw error;
        });
    } catch (error) {
      busy = false;
      throw error;
    }
  };
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    ports.authority.signal.removeEventListener('abort', abort);
    ports.onDispose();
    const retired = broker.dispose(); // revokes its waiter synchronously
    disposal = Promise.allSettled([retired, ...pending]).then(() => undefined);
    return disposal;
  };
  const abort = () => {
    void dispose();
  };
  ports.authority.signal.addEventListener('abort', abort, { once: true });
  check();
  return Object.freeze({
    async status() {
      check();
      const current = await ports.storage.enrollment.read();
      check();
      return Object.freeze({ enabled: !!current?.enrollmentId });
    },
    beginEnrollment: (value) => begin('issue', password(value)),
    beginUnlock: () => begin('resume', null),
    async complete(operationId, ceremonyId, response) {
      try {
        check();
        const result = await broker.complete(operationId, ceremonyId, response);
        check();
        return result;
      } catch (error) {
        await dispose();
        throw error;
      }
    },
    cancel: (operationId) => broker.cancel(operationId),
    disable(value) {
      check();
      if (busy) return Promise.reject(localPasskeyError());
      const secret = password(value);
      busy = true;
      return track(
        ports
          .disable(
            async () => {
              // Disabling only revokes the exact enrolled wrapper; it never opens a ceremony.
              const enrollment = createDeviceUnlockEnrollment({
                credentials: {
                  async available() {
                    return false;
                  },
                  async read() {
                    throw localPasskeyError();
                  },
                  async stage() {
                    throw localPasskeyError();
                  },
                  remove: ports.storage.credentials.remove,
                },
                enrollment: ports.storage.enrollment,
                randomId: ports.randomId,
              });
              await enrollment.disable(check);
            },
            secret,
            check
          )
          .finally(() => {
            busy = false;
          })
      );
    },
    dispose,
  });
}
