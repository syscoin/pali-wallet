import { getController } from '..';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import { saveMainState } from 'state/store';
import { updateMutex } from 'utils/asyncMutex';

export async function checkForUpdates(
  isPolling?: boolean,
  isRapidPolling?: boolean
): Promise<boolean> {
  // Use AsyncMutex for cross-context synchronization
  // This ensures only one update check runs at a time across all contexts
  return updateMutex.runExclusive(async () => {
    if (isPollingRunNotValid()) {
      console.log('⏸️ checkForUpdates: Polling run not valid, skipping');
      return true;
    }

    // Skip all updates if we're on the hardware wallet page
    // Hardware wallet pages don't need balance/asset/transaction updates
    try {
      const tabs = await chrome.tabs.query({});
      const isExternal = tabs.some((tab) => tab.url?.includes('external'));
      if (isExternal) {
        console.log(
          '⏸️ checkForUpdates: Skipping updates - external wallet page is open'
        );
        return true;
      }
    } catch (error) {
      // If we can't check the URL, continue with updates
      console.warn('[checkForUpdates] Could not check tab URLs:', error);
    }

    console.log('✅ checkForUpdates: Proceeding with update');

    // Always use direct controller call since we're already in the background
    // This avoids unnecessary errors when popup is closed
    try {
      await getController().wallet.getLatestUpdateForCurrentAccount(
        isPolling,
        false, // forceUpdate
        isRapidPolling
      );

      // Save main state after successful update (excludes vault data)
      await saveMainState();
    } catch (error) {
      console.error('Error updating account in checkForUpdates:', error);
    }

    return true;
  });
}
