import { createAppUpdateAdapter } from '../../modules/pali-app-updates/index.ts';

export type {
  AppUpdateAvailability, AppUpdateInstallStatus, AppUpdateMode, AppUpdateStartResult, AppUpdateState,
} from '../../modules/pali-app-updates/index.ts';

const adapter = createAppUpdateAdapter(() => null);
export const { checkAppUpdate, startAppUpdate, completeAppUpdate, subscribeAppUpdates } = adapter;
