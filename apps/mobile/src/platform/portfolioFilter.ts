import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createPortfolioFilter } from '../portfolio/portfolioFilter';

const key = 'pali.mobile.portfolio-network';
const options: SecureStore.SecureStoreOptions = { keychainService: 'org.pali.mobile.display', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let memory: string | null = null;
export const portfolioFilter = createPortfolioFilter({
  get: () => Platform.OS === 'web' ? Promise.resolve(memory) : SecureStore.getItemAsync(key, options),
  set: async value => { if (Platform.OS === 'web') memory = value; else await SecureStore.setItemAsync(key, value, options); },
});
