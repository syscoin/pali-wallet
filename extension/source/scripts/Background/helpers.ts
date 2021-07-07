export const getHost = (url: string) => {
  return new URL(url).host;
};

export const sendMessage = (eventReceivedDetails: any, postMessageDetails: any) => {
  return new Promise((resolve) => {
    const callback = (event: any) => {
      if (event.data.type === eventReceivedDetails.type && event.data.target === eventReceivedDetails.target) {
        resolve(
          eventReceivedDetails.freeze
          ? Object.freeze(event.data[eventReceivedDetails.eventResult])
          : event.data[eventReceivedDetails.eventResult]
        );

        console.log('event result', eventReceivedDetails, event.data[eventReceivedDetails.eventResult]);

        window.removeEventListener('message', callback);

        return true;
      }

      return false;
    };

    window.addEventListener('message', callback);
      
    window.postMessage(postMessageDetails, '*');
  });
}