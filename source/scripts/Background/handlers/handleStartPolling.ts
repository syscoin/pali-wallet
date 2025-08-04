import { startPolling } from '../utils/startPolling';

export const handleStartPolling = () => {
  // Check if alarm already exists to prevent duplicates
  chrome.alarms.get('check_for_updates', (alarm) => {
    if (!alarm) {
      console.log('🎯 handleStartPolling: Creating initial polling alarm');
      // Directly call startPolling instead of sending a message
      startPolling().catch((error) =>
        console.error('Error starting polling:', error)
      );
    } else {
      console.log(
        '🎯 handleStartPolling: Polling alarm already exists, skipping duplicate creation'
      );
    }
  });
};
