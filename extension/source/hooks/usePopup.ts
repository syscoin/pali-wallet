import { useBrowser } from 'hooks/index';

export const usePopup = () => {
  const { browser } = useBrowser();

  const closePopup = async () => {
    await browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  }

  return {
    closePopup,
  }
}