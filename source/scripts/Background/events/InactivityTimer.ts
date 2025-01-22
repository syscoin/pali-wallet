export const startInactivityTimer = async (autolockMinutes: number) => {
  const autoLockMilliseconds = autolockMinutes * 60 * 1000;

  await chrome.storage.local.set({ autoLockMilliseconds });

  const resetTimer = () => {
    chrome.storage.local.set({ lastActivityTimestamp: Date.now() });
  };

  // DOM Events
  const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'click'];

  events.forEach((event) => {
    document.addEventListener(event, resetTimer);
  });
  await chrome.alarms.clear('check_inactivity');
  await chrome.alarms.create('check_inactivity', { periodInMinutes: 0.01 });
};

export const checkInactivity = async () => {
  const { lastActivityTimestamp, autoLockMilliseconds } =
    await chrome.storage.local.get([
      'lastActivityTimestamp',
      'autoLockMilliseconds',
    ]);

  const currentTime = Date.now();
  if (currentTime - lastActivityTimestamp >= autoLockMilliseconds) {
    await chrome.runtime.sendMessage({
      type: 'lock_wallet',
      target: 'background',
    });
  }
};
