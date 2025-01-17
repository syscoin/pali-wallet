export function startPendingTransactionsPolling() {
  chrome.alarms.create('check_pending_transactions', {
    periodInMinutes: 120, //run after 2 hours
  });
}
