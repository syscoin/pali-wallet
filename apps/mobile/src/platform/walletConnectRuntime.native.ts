import * as Application from 'expo-application';
import * as NetInfo from '@react-native-community/netinfo';
import { Linking, Platform } from 'react-native';
import { decode, encode } from 'base-64';
import { ensureNativeCryptoReady } from './cryptoBootstrap';

const originalWebSocket = globalThis.WebSocket;

/** Also used before qualification installs its restrictive constructor subclass. */
export async function getWalletConnectWebSocket(): Promise<typeof WebSocket> {
  if (Platform.OS !== 'android') return globalThis.WebSocket;
  const { getAndroidWebSocket } = await import(
    '../../modules/pali-walletconnect-socket'
  );
  return getAndroidWebSocket();
}

/** Supply platform services only after the wallet's existing crypto qualification. */
export async function prepareWalletConnectRuntime(): Promise<void> {
  const crypto = await ensureNativeCryptoReady();
  const socket = await getWalletConnectWebSocket();
  if (Platform.OS === 'android' && globalThis.WebSocket !== socket) {
    if (globalThis.WebSocket === originalWebSocket)
      globalThis.WebSocket = socket;
    else if (!socket.prototype.isPrototypeOf(globalThis.WebSocket?.prototype))
      throw new Error('NATIVE_CONNECTION_UNAVAILABLE');
  }
  if (typeof globalThis.atob !== 'function') globalThis.atob = decode;
  if (typeof globalThis.btoa !== 'function') globalThis.btoa = encode;
  if (
    globalThis.crypto !== crypto ||
    typeof crypto.getRandomValues !== 'function' ||
    typeof globalThis.Buffer !== 'function' ||
    typeof globalThis.URL !== 'function' ||
    typeof globalThis.TextEncoder !== 'function' ||
    typeof globalThis.TextDecoder !== 'function' ||
    typeof globalThis.atob !== 'function' ||
    typeof globalThis.btoa !== 'function' ||
    !['ios', 'android'].includes(Platform.OS)
  ) {
    throw new Error('NATIVE_CONNECTION_UNAVAILABLE');
  }
  // These are the services consumed by the official protocol library. Wallet
  // entropy and encryption continue through the qualified native provider.
  Object.assign(globalThis, { Application, NetInfo, Linking, Platform });
}
