export async function createOffscreen() {
  await chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'keep service worker running',
    })
    .catch(() => {});
}

export const handleOffScreen = () => {
  chrome.runtime.onStartup.addListener(createOffscreen);
  createOffscreen();
};
