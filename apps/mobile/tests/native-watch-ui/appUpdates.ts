import { unavailableAppUpdateState, type AppUpdateState } from '../../modules/pali-app-updates';

// Public presentation fixture only: no Play bridge or installation action.
export * from '../../modules/pali-app-updates';
export async function checkAppUpdate(): Promise<AppUpdateState> {
  const status = new URLSearchParams(window.location.search).get('update-progress');
  return status === 'pending' || status === 'downloading' || status === 'downloaded' || status === 'failed'
    ? { ...unavailableAppUpdateState, supported: true, storeAvailable: true,
      availability: 'in-progress', installStatus: status, bytesDownloaded: 42, totalBytesToDownload: 100 }
    : unavailableAppUpdateState;
}
export const subscribeAppUpdates = () => () => {};
export const startAppUpdate = async () => { throw new Error('Presentation fixture cannot install'); };
export const completeAppUpdate = startAppUpdate;
