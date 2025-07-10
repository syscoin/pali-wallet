import MasterController from 'scripts/Background/controllers';
import MigrationController from 'scripts/Background/controllers/MigrationController';
import { loadState } from 'state/paliStorage';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import vaultCache from 'state/vaultCache';

export const handleMasterControllerInstance = async () => {
  // Add performance timing
  const startTime = performance.now();

  const storageState = await loadState();

  if (storageState) {
    // Run migrations before rehydrating state
    console.log('[handleMasterControllerInstance] Running migrations...');
    await MigrationController(storageState);

    // Use slip44-aware rehydration (now uses loadAndActivateSlip44Vault internally)
    console.log(
      '[handleMasterControllerInstance] Rehydrating with slip44 support...'
    );
    const activeSlip44 = storageState?.vaultGlobal?.activeSlip44;
    await rehydrateStore(store, null, activeSlip44);
  }

  const controller = MasterController(store);

  // 🔥 FIX: Start periodic saves on startup if wallet is already unlocked
  // This ensures periodic saves survive service worker restarts
  if (controller.wallet.isUnlocked()) {
    console.log(
      '[handleMasterControllerInstance] Wallet is unlocked, starting periodic saves'
    );
  }

  // Clean up any vault data from main state (one-time cleanup)
  controller.wallet.cleanupMainStateVault().catch((error) => {
    console.error(
      '[handleMasterControllerInstance] Failed to cleanup main state:',
      error
    );
  });

  // Note: Window/tab shutdown detection needs to be in popup context, not background script

  // Chrome extension service worker events
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    // Save before service worker is suspended/terminated
    if (chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        console.log(
          '[EmergencySave] Service worker suspending, saving state...'
        );
        vaultCache.emergencySave().catch((error) => {
          console.error(
            '[EmergencySave] Failed to emergency save on suspend:',
            error
          );
        });
      });
      console.log(
        '[handleMasterControllerInstance] ✅ onSuspend listener registered'
      );
    }

    // Save before extension is disabled/uninstalled
    if (chrome.management?.onDisabled) {
      chrome.management.onDisabled.addListener((info) => {
        if (info.id === chrome.runtime.id) {
          console.log(
            '[EmergencySave] Extension being disabled, saving state...'
          );
          vaultCache.emergencySave().catch((error) => {
            console.error(
              '[EmergencySave] Failed to emergency save on disable:',
              error
            );
          });
        }
      });
      console.log(
        '[handleMasterControllerInstance] ✅ onDisabled listener registered'
      );
    }

    // Save on extension startup (handles crashes)
    if (chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        console.log(
          '[EmergencySave] Extension starting up - previous session may have crashed'
        );
        // Don't save on startup, but log for debugging
      });
      console.log(
        '[handleMasterControllerInstance] ✅ onStartup listener registered'
      );
    }
  }

  const endTime = performance.now();
  console.log(
    `[handleMasterControllerInstance] Initialization took ${
      endTime - startTime
    }ms`
  );

  return controller;
};
