setInterval(async () => {
  (await navigator.serviceWorker.ready).active.postMessage('keepAlive');
}, 2000);

export {};
