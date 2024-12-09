export const startInactivityTimer = (autolockMinutes: number) => {
  const autoLockMilliseconds = autolockMinutes * 60 * 1000;
  let lastActivityTimestamp = Date.now();

  const resetTimer = () => {
    lastActivityTimestamp = Date.now();
  };

  const checkInactivity = () => {
    const currentTime = Date.now();
    if (currentTime - lastActivityTimestamp >= autoLockMilliseconds) {
      chrome.runtime.sendMessage({
        type: 'lock_wallet',
        target: 'background',
      });
    }
  };

  // DOM Events
  const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'click'];

  events.forEach((event) => {
    document.addEventListener(event, resetTimer);
  });

  setInterval(checkInactivity, 1000);
};
