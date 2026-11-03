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

/** Owned by the wallet authority. A dapp cannot create or acquire this port. */
export class LedgerHostBroker {
  private port?: chrome.runtime.Port;
  private windowId?: number;
  private nonce?: string;
  private generation = 0;
  private sequence = 0;
  private connecting?: Promise<void>;
  private deviceReady = false;
  private ready?: () => void;
  private failReady?: (error: Error) => void;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private creation?: Promise<chrome.windows.Window>;
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
      (params: unknown, options?: LedgerOperationOptions) =>
        this.abortable(() => this.request(method, params), options);
    this.host = {
      connect: (_request, options) =>
        this.abortable(() => this.connect(), options),
      disconnect: () => this.disconnect(),
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
      if (id === this.windowId) void this.disconnect();
    });
  }

  private async abortable<T>(
    operation: () => Promise<T>,
    options?: LedgerOperationOptions
  ): Promise<T> {
    if (options?.signal?.aborted) throw CANCELLED();
    const progress = (status: 'pending' | 'completed' | 'error') => {
      try {
        options?.onProgress?.({ status });
      } catch {
        /* Observer only. */
      }
    };
    const abort = () => {
      void this.disconnect();
    };
    options?.signal?.addEventListener('abort', abort, { once: true });
    progress('pending');
    try {
      const result = await operation();
      if (options?.signal?.aborted) throw CANCELLED();
      progress('completed');
      return result;
    } catch (error) {
      progress('error');
      throw error;
    } finally {
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
          else if (window.id)
            void this.api.windows.remove(window.id).catch(() => undefined);
        },
        () => void this.disconnect()
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

  private async request(method: LedgerMethod, request: unknown): Promise<any> {
    const params = snapshotLedgerMessage(request);
    const id = ++this.sequence;
    const envelope = snapshotLedgerMessage({
      type: 'request',
      id,
      method,
      request: params,
    });
    const generation = this.generation;
    await this.connect();
    if (generation !== this.generation || !this.port) throw CANCELLED();
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

  async disconnect(): Promise<void> {
    this.generation++;
    const port = this.port;
    const windowId = this.windowId;
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
    try {
      port?.disconnect();
    } catch {
      /* Already disconnected. */
    }
    if (windowId !== undefined)
      await this.api.windows.remove(windowId).catch(() => undefined);
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
