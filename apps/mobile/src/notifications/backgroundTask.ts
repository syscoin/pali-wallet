import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { ACTIVITY_BACKGROUND_TASK } from './constants.ts';

// Entry-point import only defines the task. No storage, wallet, RNG, or RPC opens
// until the OS invokes it; background launches do not mount React components.
TaskManager.defineTask(ACTIVITY_BACKGROUND_TASK, async () => {
  const controller = new AbortController();
  const expiry = BackgroundTask.addExpirationListener(() => controller.abort());
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    const { ensureNativeCryptoReady } = await import('../platform/cryptoBootstrap');
    await ensureNativeCryptoReady();
    if (controller.signal.aborted) return BackgroundTask.BackgroundTaskResult.Failed;
    const { runNotificationBackgroundTask } = await import('./service.native.ts');
    await runNotificationBackgroundTask(controller.signal);
    return controller.signal.aborted ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch { return BackgroundTask.BackgroundTaskResult.Failed; }
  finally { controller.abort(); clearTimeout(timeout); expiry.remove(); }
});
