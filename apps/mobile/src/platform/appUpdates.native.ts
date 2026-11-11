import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { createAppUpdateAdapter, type AppUpdateNativePort } from '../../modules/pali-app-updates/index.ts';

export type {
  AppUpdateAvailability, AppUpdateInstallStatus, AppUpdateMode, AppUpdateStartResult, AppUpdateState,
} from '../../modules/pali-app-updates/index.ts';

const adapter = createAppUpdateAdapter(() => Platform.OS === 'android'
  ? requireOptionalNativeModule<AppUpdateNativePort>('PaliAppUpdates') : null);

export const { checkAppUpdate, startAppUpdate, completeAppUpdate, subscribeAppUpdates } = adapter;
