import {
  LEDGER_HOST_PAGE,
  LEDGER_HOST_PORT,
  ledgerError,
  snapshotLedgerMessage,
} from '../ledger/protocol';

import type { LedgerMethod } from '../ledger/protocol';
import type {
  LedgerHost,
  LedgerOperationOptions,
} from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types';

const CANCELLED = () =>
  ledgerError('HARDWARE_REQUEST_CANCELLED', 'Ledger window was closed');
const BUSY = () =>
  ledgerError('HARDWARE_SIGNER_BUSY', 'A Ledger operation is already pending');

/** Owned by the wallet authority. A dapp cannot create or acquire this port. */
export class LedgerHostBroker {
  private port?: chrome.runtime.Port;
  private windowId?: number;
  private nonce?: string;
  private generation = 0;
  private sequence = 0;
  private connecting?: Promise<void>;
  private operationOwner?: { kind: 'connect' | 'request' };
  private deviceReady = false;
  private ready?: () => void;
  private failReady?: (error: Error) => void;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private creation?: Promise<chrome.windows.Window>;
  private cleanup: Promise<void> = Promise.resolve();
  private retirement?: Promise<() => void>;
  private readonly closingWindows = new Set<number>();
  private readonly removedWindows = new Set<number>();
  private pending = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (value: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  readonly host: LedgerHost;

  constructor(private readonly api: typeof chrome = chrome) {
    const request =
      (method: LedgerMethod) =>
      (params: unknown, options?: LedgerOperationOptions) => {
        const owner = options && { ...options };
        if (
          method === 'utxo.signPsbt' &&
          (typeof owner?.assertCurrent !== 'function' ||
            typeof owner.signal?.aborted !== 'boolean' ||
            typeof owner.signal.addEventListener !== 'function' ||
            typeof owner.signal.removeEventListener !== 'function')
        )
          return Promise.reject(CANCELLED());
        return this.abortable(
          (assertCurrent) => this.request(method, params, assertCurrent),
          owner,
          'request'
        );
      };
    this.host = {
      connect: (_request, options) => {
        const connecting = this.connecting;
        if (connecting && this.operationOwner?.kind === 'connect')
          return this.abortable(() => connecting, options, 'join');
        return this.abortable(() => this.connect(), options, 'connect');
      },
      disconnect: () => this.disconnect(),
      retire: () => this.retire(),
      getStatus: () => ({ connected: Boolean(this.port && this.deviceReady) }),
      evm: {
        getAddress: request('evm.getAddress'),
        signTransaction: request('evm.signTransaction'),
        signPersonalMessage: request('evm.signPersonalMessage'),
        signTypedData: request('evm.signTypedData'),
      },
      utxo: {
        getXpub: request('utxo.getXpub'),
        getAddress: request('utxo.getAddress'),
        getAccount: request('utxo.getAccount'),
        signMessage: request('utxo.signMessage'),
        signPsbt: request('utxo.signPsbt'),
      },
    } as LedgerHost;
    this.api.runtime.onConnect.addListener((port) => {
      if (port.name.startsWith(LEDGER_HOST_PORT)) void this.accept(port);
    });
    this.api.windows.onRemoved.addListener((id) => {
      if (id === this.windowId) {
        this.removedWindows.add(id);
        void this.disconnect();
      } else if (this.closingWindows.has(id)) this.removedWindows.add(id);
    });
  }

  private async abortable<T>(
    operation: (assertCurrent: () => void) => Promise<T>,
    options: LedgerOperationOptions | undefined,
    kind: 'connect' | 'request' | 'join'
  ): Promise<T> {
    if (options?.signal?.aborted) throw CANCELLED();
    if (this.retirement) throw BUSY();
    // Only the operation that opened or focused the device may close it.
    // A caller joining initial readiness can only cancel its own wait.
    const owner = kind === 'join' ? undefined : { kind };
    if (owner) {
      if (this.operationOwner) throw BUSY();
      this.operationOwner = owner;
    }
    const generation = this.generation;
    const assertCurrent = () => {
      const result: unknown = options?.assertCurrent?.();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw CANCELLED();
      }
      if (options?.signal?.aborted || generation !== this.generation)
        throw CANCELLED();
    };
    const progress = (status: 'pending' | 'completed' | 'error') => {
      try {
        options?.onProgress?.({ status });
      } catch {
        /* Observer only. */
      }
    };
    let cancelJoin: (() => void) | undefined;
    const abort = () => {
      if (
        owner &&
        this.operationOwner === owner &&
        generation === this.generation
      )
        void this.disconnect();
      cancelJoin?.();
    };
    try {
      options?.signal?.addEventListener('abort', abort, { once: true });
      progress('pending');
      assertCurrent();
      const pending = operation(assertCurrent);
      const result =
        kind === 'join' && options?.signal
          ? await Promise.race([
              pending,
              new Promise<never>((_, reject) => {
                cancelJoin = () => reject(CANCELLED());
              }),
            ])
          : await pending;
      assertCurrent();
      progress('completed');
      assertCurrent();
      return result;
    } catch (error) {
      progress('error');
      throw error;
    } finally {
      if (owner && this.operationOwner === owner)
        this.operationOwner = undefined;
      options?.signal?.removeEventListener('abort', abort);
    }
  }

  private async accept(port: chrome.runtime.Port): Promise<void> {
    const generation = this.generation;
    const nonce = this.nonce;
    const expectedUrl = this.api.runtime.getURL(`${LEDGER_HOST_PAGE}#${nonce}`);
    // A content script has our extension id too: require exact page, nonce,
    // frame and the window created by this pending authority request.
    if (
      !nonce ||
      port.name !== `${LEDGER_HOST_PORT}${nonce}` ||
      port.sender?.id !== this.api.runtime.id ||
      port.sender?.url !== expectedUrl ||
      port.sender?.frameId !== 0 ||
      this.port
    ) {
      port.disconnect();
      return;
    }
    try {
      const window = await this.creation;
      if (
        generation !== this.generation ||
        !window?.id ||
        port.sender?.tab?.windowId !== window.id ||
        this.port
      ) {
        port.disconnect();
        return;
      }
      this.port = port;
      port.onDisconnect.addListener(() => {
        if (this.port === port) void this.disconnect();
      });
      port.onMessage.addListener((message) => {
        if (generation !== this.generation || this.port !== port) return;
        try {
          const reply = snapshotLedgerMessage(message);
          if (reply.type === 'heartbeat') return;
          if (reply.type === 'ready') {
            this.deviceReady = true;
            clearTimeout(this.startupTimer);
            this.ready?.();
            return;
          }
          if (reply.type === 'device-disconnected') {
            this.deviceReady = false;
            for (const { reject, timer } of this.pending.values()) {
              clearTimeout(timer);
              reject(CANCELLED());
            }
            this.pending.clear();
            return;
          }
          if (!Number.isSafeInteger(reply.id)) throw CANCELLED();
          const pending = this.pending.get(reply.id);
          if (!pending) return;
          this.pending.delete(reply.id);
          clearTimeout(pending.timer);
          if (reply.ok === true) pending.resolve(reply.value);
          else
            pending.reject(
              ledgerError(
                typeof reply.code === 'string' &&
                  /^[A-Z_]{1,64}$/.test(reply.code)
                  ? reply.code
                  : 'LEDGER_DEVICE_ERROR',
                typeof reply.message === 'string'
                  ? reply.message.slice(0, 300)
                  : 'Ledger operation failed'
              )
            );
        } catch {
          void this.disconnect();
        }
      });
      port.postMessage({ type: 'attached' });
    } catch {
      port.disconnect();
    }
  }

  private async focusOwnedWindow(): Promise<void> {
    const generation = this.generation;
    const windowId = this.windowId;
    if (windowId === undefined) throw CANCELLED();
    try {
      await this.api.windows.update(windowId, { focused: true });
    } catch {
      if (generation === this.generation) await this.disconnect();
      throw CANCELLED();
    }
    if (generation !== this.generation || windowId !== this.windowId)
      throw CANCELLED();
  }

  private connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.port && this.deviceReady) return this.focusOwnedWindow();
    const existingPort = this.port;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    if (!existingPort)
      this.nonce = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    const promise = new Promise<void>((resolve, reject) => {
      this.ready = resolve;
      this.failReady = reject;
      this.startupTimer = setTimeout(() => void this.disconnect(), 180000);
    });
    this.connecting = promise;
    const generation = this.generation;
    if (!existingPort)
      this.creation = this.api.windows.create({
        url: this.api.runtime.getURL(`${LEDGER_HOST_PAGE}#${this.nonce}`),
        type: 'popup',
        width: 480,
        height: 680,
        focused: true,
      });
    if (!existingPort)
      void this.creation!.then(
        (window) => {
          if (generation === this.generation) this.windowId = window.id;
          // Revocation owns cleanup, including a window created after it.
        },
        () => {
          if (generation === this.generation) void this.disconnect();
        }
      );
    else if (this.windowId !== undefined)
      void this.focusOwnedWindow().catch(() => undefined);
    void promise
      .finally(() => {
        if (this.connecting === promise) {
          this.connecting = undefined;
          this.ready = undefined;
          this.failReady = undefined;
        }
      })
      .catch(() => undefined);
    return promise;
  }

  private async request(
    method: LedgerMethod,
    request: unknown,
    assertCurrent: () => void
  ): Promise<any> {
    const generation = this.generation;
    const params = snapshotLedgerMessage(request);
    const id = ++this.sequence;
    const envelope = snapshotLedgerMessage({
      type: 'request',
      id,
      method,
      request: params,
    });
    if (generation !== this.generation) throw CANCELLED();
    await this.connect();
    if (generation !== this.generation || !this.port) throw CANCELLED();
    assertCurrent();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => void this.disconnect(), 300000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port!.postMessage(envelope);
      } catch {
        void this.disconnect();
      }
    });
  }

  private revoke() {
    this.generation++;
    this.operationOwner = undefined;
    const port = this.port;
    const windowId = this.windowId;
    const creation = this.creation;
    if (windowId !== undefined) this.closingWindows.add(windowId);
    this.port = undefined;
    this.deviceReady = false;
    this.windowId = undefined;
    this.nonce = undefined;
    this.creation = undefined;
    clearTimeout(this.startupTimer);
    this.failReady?.(CANCELLED());
    this.connecting = undefined;
    this.ready = undefined;
    this.failReady = undefined;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(CANCELLED());
    }
    this.pending.clear();
    return { port, windowId, creation };
  }

  private async closeWindow(owner: {
    creation?: Promise<chrome.windows.Window>;
    windowId?: number;
  }): Promise<void> {
    const window = await owner.creation?.catch(() => undefined);
    const id = owner.windowId ?? window?.id;
    if (id === undefined) return;
    this.closingWindows.add(id);
    try {
      if (!this.removedWindows.has(id)) await this.api.windows.remove(id);
    } catch (error) {
      if (!this.removedWindows.has(id)) throw error;
    } finally {
      this.closingWindows.delete(id);
      this.removedWindows.delete(id);
    }
  }

  private closePort(port?: chrome.runtime.Port): void {
    try {
      port?.disconnect();
    } catch {
      /* Already disconnected. */
    }
  }

  disconnect(): Promise<void> {
    const owner = this.revoke();
    this.closePort(owner.port);
    const closing = this.closeWindow(owner);
    this.cleanup = Promise.all([this.cleanup, closing]).then(() => undefined);
    void this.cleanup.catch(() => undefined);
    // Immediate cancellation keeps the established disconnect behavior.
    return owner.windowId === undefined
      ? Promise.resolve()
      : closing.catch(() => undefined);
  }

  private retirePort(port: chrome.runtime.Port): Promise<void> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        port.onMessage.removeListener(receive);
        port.onDisconnect.removeListener(disconnected);
        if (error) reject(error);
        else resolve();
      };
      const disconnected = () => finish(CANCELLED());
      const receive = (input: unknown) => {
        try {
          const reply = snapshotLedgerMessage(input);
          if (reply.type !== 'retired' || reply.id !== id) return;
          finish(reply.ok === true ? undefined : CANCELLED());
        } catch {
          finish(CANCELLED());
        }
      };
      const timer = setTimeout(() => finish(CANCELLED()), 300000);
      port.onMessage.addListener(receive);
      port.onDisconnect.addListener(disconnected);
      try {
        port.postMessage({ type: 'retire', id });
      } catch {
        finish(CANCELLED());
      }
    });
  }

  retire(): Promise<() => void> {
    if (this.retirement) return this.retirement;
    let resolve!: (guard: () => void) => void;
    let reject!: (error: unknown) => void;
    const retirement = new Promise<() => void>((accept, refuse) => {
      resolve = accept;
      reject = refuse;
    });
    this.retirement = retirement;
    const owner = this.revoke();
    const generation = this.generation;
    const previousCleanup = this.cleanup;
    void (async () => {
      try {
        try {
          if (owner.port) await this.retirePort(owner.port);
          await previousCleanup;
        } finally {
          this.closePort(owner.port);
          const closing = this.closeWindow(owner);
          this.cleanup = Promise.all([previousCleanup, closing]).then(
            () => undefined
          );
          await this.cleanup;
        }
        const assertRetired = () => {
          if (
            generation !== this.generation ||
            this.port ||
            this.windowId !== undefined ||
            this.creation ||
            this.connecting ||
            this.operationOwner ||
            this.pending.size
          )
            throw CANCELLED();
        };
        assertRetired();
        resolve(assertRetired);
      } catch (error) {
        reject(error);
      } finally {
        if (this.retirement === retirement) this.retirement = undefined;
      }
    })();
    return retirement;
  }
}

let broker: LedgerHostBroker | undefined;
let guardInstalled = false;
const installUnownedPortGuard = () => {
  if (guardInstalled || !globalThis.chrome?.runtime?.onConnect) return;
  guardInstalled = true;
  chrome.runtime.onConnect.addListener((port) => {
    // A page opened before the first device request has no owner. Do not leave
    // it attached merely because the device broker has not been constructed.
    if (!broker && port.name.startsWith(LEDGER_HOST_PORT)) port.disconnect();
  });
};
const activeHost = () => (broker ??= new LedgerHostBroker()).host;
// Software wallet initialization must not initialize device-only browser APIs.
const lazyHost: LedgerHost = {
  connect: (...args) => activeHost().connect(...args),
  disconnect: () => broker?.host.disconnect() ?? Promise.resolve(),
  retire: () =>
    broker
      ? broker.host.retire()
      : Promise.resolve(() => {
          if (broker) throw CANCELLED();
        }),
  getStatus: () => broker?.host.getStatus() ?? { connected: false },
  evm: {
    getAddress: (...args) => activeHost().evm.getAddress(...args),
    signTransaction: (...args) => activeHost().evm.signTransaction(...args),
    signPersonalMessage: (...args) =>
      activeHost().evm.signPersonalMessage(...args),
    signTypedData: (...args) => activeHost().evm.signTypedData(...args),
  },
  utxo: {
    getXpub: (...args) => activeHost().utxo.getXpub(...args),
    getAddress: (...args) => activeHost().utxo.getAddress(...args),
    getAccount: (...args) => activeHost().utxo.getAccount(...args),
    signMessage: (...args) => activeHost().utxo.signMessage(...args),
    signPsbt: (...args) => activeHost().utxo.signPsbt(...args),
  },
};
export const getLedgerHost = (): LedgerHost => {
  installUnownedPortGuard();
  return lazyHost;
};
