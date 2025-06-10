export const handleStartPolling = () => {
  // Check if alarm already exists to prevent duplicates
  chrome.alarms.get('check_for_updates', (alarm) => {
    if (!alarm) {
      console.log('🎯 handleStartPolling: Creating initial polling alarm');
      chrome.runtime.sendMessage({ type: 'startPolling' });
    } else {
      console.log(
        '🎯 handleStartPolling: Polling alarm already exists, skipping duplicate creation'
      );
    }
  });
};
