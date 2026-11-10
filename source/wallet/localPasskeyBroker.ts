import {
  captureLocalPasskeyResponse,
  checkLocalPasskeyOwner,
  localPasskeyError,
  type LocalPasskeyCeremonyPort,
  type LocalPasskeyPrompt,
  type LocalPasskeyResponse,
  type LocalPasskeyStep,
} from './localPasskeyTypes';

const LIFETIME_MS = 90_000;
type Pending = {
  prompt: LocalPasskeyPrompt;
  reject(error: unknown): void;
  resolve(response: LocalPasskeyResponse): void;
};
type Waiter = {
  reject(error: unknown): void;
  resolve(step: LocalPasskeyStep): void;
};
type Operation = {
  cancelled: boolean;
  check(): void;
  done: Promise<void>;
  id: string;
  pending?: Pending;
  timer?: ReturnType<typeof setTimeout>;
  waiter?: Waiter;
};
/** Private, bounded bridge for one SDK issue/resume operation. No public success assertion grants authority. */
export function createLocalPasskeyBroker(
  ports: Readonly<{
    clearTimer?: typeof clearTimeout;
    now(): number;
    randomId(): string;
    setTimer?: typeof setTimeout;
    wallTime(): number;
  }>
) {
  let active: Operation | undefined;
  let closed = false;
  const timer = ports.setTimer ?? setTimeout,
    clear = ports.clearTimer ?? clearTimeout;
  const randomId = () => {
    const id = ports.randomId();
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id))
      throw localPasskeyError();
    return id;
  };
  const retire = (operation: Operation, error: unknown) => {
    operation.cancelled = true;
    operation.pending?.reject(error);
    operation.pending = undefined;
    operation.waiter?.reject(error);
    operation.waiter = undefined;
  };
  const wait = (operation: Operation) =>
    new Promise<LocalPasskeyStep>((resolve, reject) => {
      if (operation.waiter) throw localPasskeyError();
      operation.waiter = { resolve, reject };
    });
  return Object.freeze({
    begin(
      work: (
        ceremonies: LocalPasskeyCeremonyPort,
        assertCurrent: () => void
      ) => Promise<boolean>,
      assertCurrent: () => void
    ): Promise<LocalPasskeyStep> {
      if (active || closed) return Promise.reject(localPasskeyError());
      checkLocalPasskeyOwner(assertCurrent);
      const started = ports.now(),
        wall = ports.wallTime();
      if (!Number.isFinite(started) || !Number.isFinite(wall))
        return Promise.reject(localPasskeyError());
      const operation: Operation = {
        id: randomId(),
        cancelled: false,
        done: Promise.resolve(),
        check() {
          const now = ports.now();
          if (
            closed ||
            active !== operation ||
            operation.cancelled ||
            !Number.isFinite(now) ||
            now < started ||
            now >= started + LIFETIME_MS
          )
            throw localPasskeyError();
          checkLocalPasskeyOwner(assertCurrent);
          if (active !== operation || operation.cancelled || closed)
            throw localPasskeyError();
        },
      };
      active = operation;
      const next = wait(operation);
      const ceremonies: LocalPasskeyCeremonyPort = Object.freeze({
        request(request, check) {
          operation.check();
          checkLocalPasskeyOwner(check);
          if (operation.pending || !operation.waiter)
            return Promise.reject(localPasskeyError());
          const prompt: LocalPasskeyPrompt = Object.freeze({
            ...request,
            operationId: operation.id,
            ceremonyId: randomId(),
            expiresAt: wall + LIFETIME_MS,
          });
          operation.check();
          const response = new Promise<LocalPasskeyResponse>(
            (resolve, reject) => {
              operation.pending = { prompt, resolve, reject };
            }
          );
          const waiter = operation.waiter;
          operation.waiter = undefined;
          waiter.resolve(prompt);
          return response.then((value) => {
            operation.check();
            checkLocalPasskeyOwner(check);
            operation.check();
            return value;
          });
        },
      });
      operation.timer = timer(
        () => retire(operation, localPasskeyError()),
        LIFETIME_MS
      );
      operation.done = Promise.resolve()
        .then(async () => {
          operation.check();
          const success = await work(ceremonies, operation.check);
          operation.check();
          if (
            typeof success !== 'boolean' ||
            operation.pending ||
            !operation.waiter
          )
            throw localPasskeyError();
          operation.waiter.resolve(
            Object.freeze({
              kind: 'complete',
              operationId: operation.id,
              success,
            })
          );
          operation.waiter = undefined;
        })
        .catch((error) => {
          retire(operation, error);
        })
        .finally(() => {
          if (operation.timer !== undefined) clear(operation.timer);
          if (active === operation) active = undefined;
        });
      return next;
    },
    complete(
      operationId: string,
      ceremonyId: string,
      response: LocalPasskeyResponse
    ): Promise<LocalPasskeyStep> {
      const operation = active;
      if (!operation || operation.id !== operationId)
        return Promise.reject(localPasskeyError());
      const pending = operation.pending;
      if (!pending || pending.prompt.ceremonyId !== ceremonyId)
        return Promise.reject(localPasskeyError());
      try {
        operation.check();
        const captured = captureLocalPasskeyResponse(response);
        operation.check();
        if (
          active !== operation ||
          operation.pending !== pending ||
          captured.kind !== pending.prompt.kind
        )
          throw localPasskeyError();
        const next = wait(operation);
        operation.pending = undefined;
        pending.resolve(captured);
        return next;
      } catch (error) {
        retire(operation, error);
        return Promise.reject(error);
      }
    },
    async cancel(operationId?: string): Promise<void> {
      const operation = active;
      if (
        !operation ||
        (operationId !== undefined && operation.id !== operationId)
      )
        return;
      retire(operation, localPasskeyError());
      await operation.done;
    },
    async dispose(): Promise<void> {
      closed = true;
      const operation = active;
      if (operation) {
        retire(operation, localPasskeyError());
        await operation.done;
      }
    },
  });
}
