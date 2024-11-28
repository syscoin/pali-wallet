export const keepSWAlive = () => {
  chrome.runtime.sendMessage({
    type: 'ping',
    target: 'background',
  });
};
