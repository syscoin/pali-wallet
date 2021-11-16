export const getHost = (url: string) => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};


export const sendMessage = (
  eventReceivedDetails: any,
  postMessageDetails: any
) => {
  return new Promise((resolve) => {
    const callback = (event: any) => {
      if (
        event.data.type === eventReceivedDetails.type &&
        event.data.target === eventReceivedDetails.target
      ) {
        resolve(
          eventReceivedDetails.freeze
            ? Object.freeze(event.data[eventReceivedDetails.eventResult])
            : event.data[eventReceivedDetails.eventResult]
        );

        window.removeEventListener('message', callback);

        return true;
      }

      return false;
    };

    window.addEventListener('message', callback);

    window.postMessage(postMessageDetails, '*');
  });
};
