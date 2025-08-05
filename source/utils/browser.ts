export const getController = () => {
  // const { controller } = browser.extension.getBackgroundPage();
  // if (controller) return controller;
  // chrome.runtime.reload();
  const controller = window?.controller;
  return controller;
};

export const dispatchBackgroundEvent = (eventName: string, data: any) => {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
    return;
  }
  navigator.serviceWorker.controller.postMessage({
    eventName,
    detail: JSON.stringify(data),
  });
};

export const reload = () => {
  chrome.runtime.reload();
};
