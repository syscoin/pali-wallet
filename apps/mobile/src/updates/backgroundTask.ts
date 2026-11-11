import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { UPDATE_BACKGROUND_TASK } from './constants';

// Public release metadata only; this task never imports or unlocks the wallet.
TaskManager.defineTask(UPDATE_BACKGROUND_TASK, async () => {
  try {
    const { mobileUpdates } = await import('./service.native');
    await mobileUpdates.check();
    return mobileUpdates.getSnapshot().status === 'error' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});
