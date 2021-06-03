const VERSION = '8.1.27';
const versionN = VERSION.split('.').map(s => parseInt(s, 10));
const DIRECTORY = `${versionN[0]}/`;
const url = `*://connect.trezor.io/${DIRECTORY}`;
// const url = `https://localhost:8088/`
/* Handling messages from usb permissions iframe */
function switchToPopupTab(event) {
    window.removeEventListener('beforeunload', switchToPopupTab);

    if (!event) {
        // triggered from 'usb-permissions-close' message
        // close current tab
        chrome.tabs.query(
            {
                currentWindow: true,
                active: true,
            },
            current => {
                if (current.length < 0) return;
                chrome.tabs.remove(current[0].id);
            },
        );
    }

    // find tab by popup pattern and switch to it
    chrome.tabs.query(
        {
            url: `${url}popup.html`,
        },
        tabs => {
            if (tabs.length < 0) return;
            chrome.tabs.update(tabs[0].id, { active: true });
        },
    );
}

window.addEventListener('message', event => {
    if (event.data === 'usb-permissions-init') {
        const iframe = document.getElementById('trezor-usb-permissions');
        if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
            throw new Error('trezor-usb-permissions missing or incorrect dom type');
        }
        iframe.contentWindow.postMessage(
            {
                type: 'usb-permissions-init',
                extension: chrome.runtime.id,
            },
            '*',
        );
    } else if (event.data === 'usb-permissions-close') {
        switchToPopupTab();
    }
});

window.addEventListener('beforeunload', switchToPopupTab);
window.addEventListener('load', () => {
    const instance = document.createElement('iframe');
    instance.id = 'trezor-usb-permissions';
    instance.frameBorder = '0';
    instance.width = '100%';
    instance.height = '100%';
    instance.style.border = '0px';
    instance.style.width = '100%';
    instance.style.height = '100%';
    instance.setAttribute('src', `${url}extension-permissions.html`);
    instance.setAttribute('allow', 'usb');

    if (document.body) {
        document.body.appendChild(instance);
    }
});
// const switchToPopupTab = (event) => {

//     window.removeEventListener('beforeunload', switchToPopupTab);
//     console.log("adding usb permission in popup switch")
//     if (!event) {
//         // triggered from 'usb-permissions-close' message
//         // switch tab to previous index and close current
//         chrome.tabs.query({
//             currentWindow: true,
//             active: true,
//         }, (current) => {
//             if (current.length < 0) return;
//             chrome.tabs.query({
//                 index: current[0].index - 1
//             }, popup => {
//                 if (popup.length < 0) return;
//                 chrome.tabs.update(popup[0].id, { active: true });
//             })
//             chrome.tabs.remove(current[0].id);
//         });
//         return;
//     }

//     // TODO: remove this query, or add `tabs` permission. This does not work.
//     // triggered from 'beforeunload' event
//     // find tab by popup pattern and switch to it
//     chrome.tabs.query({
//         url: "*://connect.trezor.io/*/popup.html"
//     }, (tabs) => {
//         if (tabs.length < 0) return;
//         chrome.tabs.update(tabs[0].id, { active: true });
//     });
// }

// window.addEventListener('message', event => {
//     if (event.data === 'usb-permissions-init') {
//         console.log("adding usb permission")
//         const iframe = document.getElementById('trezor-usb-permissions');
//         iframe.contentWindow.postMessage({
//             type: 'usb-permissions-init',
//             extension: chrome.runtime.id,
//         }, '*');
//     } else if (event.data === 'usb-permissions-close') {
//         switchToPopupTab();
//     }
// });

// window.addEventListener('beforeunload', switchToPopupTab);