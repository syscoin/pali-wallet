import { BackHandler, Platform } from 'react-native';

type ModalPresence = Readonly<{ getSnapshot(): readonly unknown[] }>;
const hosts = new Set<ModalPresence>();
export function registerWalletModalHost(state: ModalPresence): () => void {
  hosts.add(state);
  return () => { hosts.delete(state); };
}

/** A sheet gets first refusal, regardless of underlay subscription order. */
export const WalletBackHandler = {
  addEventListener(name: 'hardwareBackPress', handler: () => boolean | undefined) {
    return BackHandler.addEventListener(name, () => {
      if (Platform.OS === 'android' && [...hosts].some(state => state.getSnapshot().length > 0)) return false;
      return handler();
    });
  },
};
