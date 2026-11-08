import { Linking } from 'react-native';
import { createNativeTrezorCallbackRouter } from './trezorCallbackRouter';
import { createTrezorSessions } from './trezorSessions';

/** Construct at engine startup. Connect code loads only for an explicit device call. */
export function createNativeTrezorSessions(options: {
  randomBytes(length: number): Uint8Array;
  now?: () => number;
}) {
  const sessions = createTrezorSessions({
    ...options,
    async loadClient() {
      const { TrezorConnectDeeplink } = await import('@trezor/connect-mobile');
      return new TrezorConnectDeeplink();
    },
    openURL: (url) => Linking.openURL(url),
  });
  const router = createNativeTrezorCallbackRouter(sessions, Linking);
  return Object.freeze({
    ...sessions,
    async dispose() {
      try {
        router.dispose();
      } finally {
        await sessions.dispose();
      }
    },
  });
}
