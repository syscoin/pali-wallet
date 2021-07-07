/*
Passing messages from background script to popup
*/

let port = chrome.runtime.connect({ name: 'trezor-connect' });
port.onMessage.addListener(message => {
    console.log("sending initial conect message")
    console.log(message)
    window.postMessage(message, window.location.origin);
});
port.onDisconnect.addListener(() => {
    port = null;
});

/*
Passing messages from popup to background script
*/

window.addEventListener('message', event => {
    console.log("sending message to popup")
    if (port && event.source === window && event.data) {
        console.log("popup message")
        console.log(event.data)
        port.postMessage({ data: event.data });
    }
});
