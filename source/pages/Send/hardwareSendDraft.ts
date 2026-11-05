import type { INavigationContext } from 'utils/navigationState';
import { stageHardwareSendDraft } from 'utils/navigationState';

export const HARDWARE_SEND_DRAFT_QUERY = 'hardwareDraft';

export const getWalletBrowserTabId = (): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    chrome.tabs.getCurrent((tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else
        resolve(Number.isInteger(tab?.id) && tab.id >= 0 ? tab.id : undefined);
    });
  });

export async function openHardwareSendDraft(
  state: Record<string, any>,
  returnContext: INavigationContext | undefined,
  assertCurrent: () => boolean
): Promise<void> {
  const id = await stageHardwareSendDraft(state, returnContext, assertCurrent);
  if (!assertCurrent()) throw new Error('Hardware Send draft context changed');
  const url = chrome.runtime.getURL(
    `app.html#/send/eth?${HARDWARE_SEND_DRAFT_QUERY}=${id}`
  );
  await new Promise<void>((resolve, reject) => {
    chrome.tabs.create({ url }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || !tab)
        reject(error ?? new Error('Could not open wallet tab'));
      else resolve();
    });
  });
}
