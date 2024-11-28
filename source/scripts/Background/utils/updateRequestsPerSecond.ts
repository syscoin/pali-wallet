import store from 'state/store';

const isWatchRequestsActive =
  process.env.NODE_ENV === 'development' &&
  process.env.WATCH_REQUESTS === 'true';

let requestCount = 0;
const requestsPerSecond = {};
export const requestCallback = (details: any) => {
  const {
    activeNetwork: { url },
  } = store.getState().vault;

  if (details.url.includes(url) && isWatchRequestsActive) {
    requestCount++;
    console.log('Request count:', requestCount);
  }

  // track all requests
  const currentTime = Math.floor(Date.now() / 1000);
  if (!requestsPerSecond[currentTime]) {
    requestsPerSecond[currentTime] = [];
  }

  requestsPerSecond[currentTime].push(details);
};

export const resetRequestCount = () => {
  requestCount = 0;
};

export const verifyAllPaliRequests = () => {
  // get all requests called by extension
  chrome.webRequest.onCompleted.addListener(requestCallback, { urls: [] });
};

// update and show requests per second
export const updateRequestsPerSecond = () => {
  const { isBitcoinBased } = store.getState().vault;
  if (
    !isBitcoinBased &&
    process.env.NODE_ENV === 'development' &&
    isWatchRequestsActive
  ) {
    const currentTime = Math.floor(Date.now() / 1000);
    const requestCountPerSecond = requestsPerSecond[currentTime]?.length || 0;
    console.log('Requests per second:', requestCountPerSecond);

    if (requestsPerSecond[currentTime]) {
      console.log('//---------REQUESTS IN THIS SECOND---------//');
      requestsPerSecond[currentTime].forEach((request: any, index: number) => {
        console.log(`Request ${index + 1}:`, request);
      });
      console.log('//----------------------------------------//');
    }

    requestsPerSecond[currentTime] = [];
  }
};
// Interval to perform the information update and display the requests per second every second.
setInterval(updateRequestsPerSecond, 1000);

export const verifyPaliRequests = () => {
  chrome.runtime.sendMessage({
    type: 'verifyPaliRequests',
    target: 'background',
  });
};

export const removeVerifyPaliRequestListener = () => {
  chrome.runtime.sendMessage({
    type: 'removeVerifyPaliRequestListener',
    target: 'background',
  });
};
export const resetPaliRequestsCount = () => {
  chrome.runtime.sendMessage({
    type: 'resetPaliRequestsCount',
    target: 'background',
  });
};
