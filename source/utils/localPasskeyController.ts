import {
  LOCAL_PASSKEY_DEADLINE_MS,
  LOCAL_PASSKEY_PASSWORD_COOLDOWN,
  LOCAL_PASSKEY_PORT,
  type LocalPasskeyCommand,
} from '../shared/localPasskeyTransport';
import {
  localPasskeyError,
  localPasskeyField,
  localPasskeyFields,
  PasswordCooldownError,
  type LocalPasskeyController,
  type LocalPasskeyStatus,
  type LocalPasskeyStep,
} from '../wallet/localPasskeyTypes';

/** A dedicated Port owns one complete ceremony, including cancellation before its first reply. */
export function createLocalPasskeyController(): LocalPasskeyController {
  type Connection = {
    close(): void;
    port: chrome.runtime.Port;
    send<T>(
      method: LocalPasskeyCommand['method'],
      params: unknown[]
    ): Promise<T>;
  };
  let operation: Connection | undefined;
  let operationId: string | undefined;
  let disposed = false;
  const connections = new Set<Connection>();
  const open = (): Connection => {
    if (disposed) throw localPasskeyError();
    const port = chrome.runtime.connect({ name: LOCAL_PASSKEY_PORT });
    let retired = false;
    let nextId = 0;
    let pending:
      | {
          id: number;
          method: LocalPasskeyCommand['method'];
          reject(error: Error): void;
          resolve(value: unknown): void;
        }
      | undefined;
    const close = () => {
      if (retired) return;
      retired = true;
      clearTimeout(deadline);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(close);
      const waiter = pending;
      pending = undefined;
      connections.delete(connection);
      waiter?.reject(localPasskeyError());
      try {
        port.disconnect();
      } catch {
        /* Already disconnected. */
      }
    };
    const receive = (message: unknown) => {
      try {
        localPasskeyFields(message, [
          'id',
          'result',
          'error',
          'retryAfterSeconds',
        ]);
        if (!pending || localPasskeyField(message, 'id') !== pending.id)
          throw localPasskeyError();
        const error = localPasskeyField(message, 'error');
        const result = localPasskeyField(message, 'result');
        const retryAfterSeconds = localPasskeyField(
          message,
          'retryAfterSeconds'
        );
        if (
          error === undefined &&
          (result === undefined || retryAfterSeconds !== undefined)
        )
          throw localPasskeyError();
        const waiter = pending;
        pending = undefined;
        if (error !== undefined) {
          const cooldown =
            error === LOCAL_PASSKEY_PASSWORD_COOLDOWN &&
            (waiter.method === 'beginEnrollment' ||
              waiter.method === 'disable') &&
            result === undefined &&
            typeof retryAfterSeconds === 'number' &&
            Number.isSafeInteger(retryAfterSeconds) &&
            retryAfterSeconds > 0;
          waiter.reject(
            cooldown
              ? new PasswordCooldownError(retryAfterSeconds)
              : localPasskeyError()
          );
          close();
        } else waiter.resolve(result);
      } catch {
        close();
      }
    };
    const deadline = setTimeout(close, LOCAL_PASSKEY_DEADLINE_MS);
    const connection: Connection = {
      port,
      close,
      send<T>(
        method: LocalPasskeyCommand['method'],
        params: unknown[]
      ): Promise<T> {
        if (disposed || retired || pending)
          return Promise.reject(localPasskeyError());
        return new Promise<T>((resolve, reject) => {
          const id = ++nextId;
          pending = {
            id,
            method,
            resolve: (value) => resolve(value as T),
            reject,
          };
          try {
            port.postMessage({ id, method, params });
          } catch {
            close();
          }
        });
      },
    };
    connections.add(connection);
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(close);
    return connection;
  };
  const begin = async (
    method: 'beginEnrollment' | 'beginUnlock',
    params: string[]
  ) => {
    if (operation || disposed) throw localPasskeyError();
    const connection = open();
    operation = connection;
    operationId = undefined;
    try {
      const step = await connection.send<LocalPasskeyStep>(method, params);
      if (operation !== connection) throw localPasskeyError();
      operationId = step.operationId;
      return step;
    } catch (error) {
      connection.close();
      if (operation === connection) operation = undefined;
      throw error;
    }
  };
  const cancel = async (id?: string) => {
    if (id !== undefined && id !== operationId) return;
    const previous = operation;
    operation = undefined;
    operationId = undefined;
    previous?.close();
  };
  return Object.freeze({
    async status(): Promise<LocalPasskeyStatus> {
      const connection = open();
      try {
        const status = await connection.send<unknown>('status', []);
        localPasskeyFields(status, ['enabled']);
        const enabled = localPasskeyField(status, 'enabled');
        if (typeof enabled !== 'boolean') throw localPasskeyError();
        return Object.freeze({ enabled });
      } finally {
        connection.close();
      }
    },
    beginEnrollment: (password) => begin('beginEnrollment', [password]),
    beginUnlock: () => begin('beginUnlock', []),
    async complete(id, ceremonyId, response): Promise<LocalPasskeyStep> {
      const connection = operation;
      if (!connection || disposed || id !== operationId)
        throw localPasskeyError();
      try {
        const result = await connection.send<LocalPasskeyStep>('complete', [
          id,
          ceremonyId,
          response,
        ]);
        if (operation !== connection) throw localPasskeyError();
        if (result?.kind === 'complete') {
          connection.close();
          if (operation === connection) {
            operation = undefined;
            operationId = undefined;
          }
        }
        return result;
      } catch (error) {
        connection.close();
        if (operation === connection) {
          operation = undefined;
          operationId = undefined;
        }
        throw error;
      }
    },
    async disable(password): Promise<void> {
      if (operation) throw localPasskeyError();
      const connection = open();
      operation = connection;
      operationId = undefined;
      try {
        await connection.send('disable', [password]);
        if (operation !== connection) throw localPasskeyError();
      } finally {
        connection.close();
        if (operation === connection) {
          operation = undefined;
          operationId = undefined;
        }
      }
    },
    cancel,
    async dispose() {
      disposed = true;
      operation = undefined;
      operationId = undefined;
      for (const connection of [...connections]) connection.close();
    },
  });
}
