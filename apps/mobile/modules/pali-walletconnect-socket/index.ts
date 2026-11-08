import { requireNativeModule } from 'expo-modules-core';
import { Blob as ExpoBlob } from 'expo-blob';
import { createNativeWebSocket, type NativeSocketPort } from './socket';

let constructor: typeof WebSocket | undefined;
export function getAndroidWebSocket(): typeof WebSocket {
  constructor ??= createNativeWebSocket(
    requireNativeModule<NativeSocketPort>('PaliWalletConnectSocket'),
    {
      create: (bytes) => new ExpoBlob([bytes]),
      isBlob: (value): value is ExpoBlob => value instanceof ExpoBlob,
      read: (value) => ExpoBlob.prototype.arrayBuffer.call(value),
    }
  );
  return constructor;
}
