import type { HttpLaunch } from './http-contract.ts';

/** A temporary exception for the fixed native loopback qualification only. */
export async function withWalletConnectQualificationScope<T>(
  options: {
    crypto: Crypto;
    WebSocket: typeof WebSocket;
    launch: HttpLaunch;
    onForbidden(): never;
  },
  operation: () => Promise<T>
): Promise<T> {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const socket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const allowed = new Set([
    `/${options.launch.token}/wc-open`,
    `/${options.launch.token}/wc-pending`,
  ]);
  let active = true;
  class LoopbackWebSocket extends options.WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      let url: URL;
      try {
        url = new URL(String(address));
      } catch {
        return options.onForbidden();
      }
      if (
        !active ||
        url.protocol !== 'ws:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== String(options.launch.port) ||
        !allowed.has(url.pathname) ||
        url.username ||
        url.password ||
        url.hash
      )
        return options.onForbidden();
      super(url.href, protocols);
    }
    send(data: Parameters<WebSocket['send']>[0]) {
      if (!active) return options.onForbidden();
      super.send(data);
    }
  }
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      enumerable: true,
      value: options.crypto,
      writable: false,
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      enumerable: true,
      value: LoopbackWebSocket,
      writable: true,
    });
    return await operation();
  } finally {
    active = false;
    try {
      if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
      else Reflect.deleteProperty(globalThis, 'crypto');
    } finally {
      if (socket) Object.defineProperty(globalThis, 'WebSocket', socket);
      else Reflect.deleteProperty(globalThis, 'WebSocket');
    }
  }
}
