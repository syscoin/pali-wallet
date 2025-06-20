import MasterController from 'scripts/Background/controllers';
import MigrationController from 'scripts/Background/controllers/MigrationController';
import { loadState } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

export const handleMasterControllerInstance = async () => {
  // Add performance timing
  const startTime = performance.now();

  const storageState = await loadState();

  if (storageState) {
    // Run migrations before rehydrating state
    console.log('[handleMasterControllerInstance] Running migrations...');
    await MigrationController(storageState);

    // Use slip44-aware rehydration instead of direct vault rehydration
    console.log(
      '[handleMasterControllerInstance] Rehydrating with slip44 support...'
    );
    const currentSlip44 = storageState?.currentSlip44;
    await rehydrateStore(store, null, currentSlip44);
  }

  const controller = MasterController(store);

  const endTime = performance.now();
  console.log(
    `[handleMasterControllerInstance] Initialization took ${
      endTime - startTime
    }ms`
  );

  return controller;
};
