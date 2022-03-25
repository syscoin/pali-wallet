import { browser } from 'webextension-polyfill-ts';

const trezorConnectVersion = '8.1.27';
const versionN = trezorConnectVersion.split('.').map((s) => parseInt(s, 10));
const DIRECTORY = `${versionN[0]}/`;
const url = `*://connect.trezor.io/${DIRECTORY}`;

/* Handling messages from usb permissions iframe */

const setTab = (event?: Event) => {
  window.removeEventListener('beforeunload', setTab);

  if (!event) {
    /**
     * triggered from 'usb-permissions-close' message
     * close current tab
     */
    const current = browser.tabs.query({ currentWindow: true, active: true });

    if (!current) return;

    browser.tabs.remove(current[0].id);
  }

  /**
   * triggered from 'usb-permissions-close' message
   * update current tab
   */
  const tabs = browser.tabs.query({ url: `${url}popup.html` });

  if (!tabs) return;

  browser.tabs.update(tabs[0].id, { active: true });
};

window.addEventListener('message', ({ data }) => {
  if (data === 'usb-permissions-init') {
    const iframe: HTMLElement | null = document.getElementById(
      'trezor-usb-permissions'
    );

    if (!iframe || !(iframe instanceof HTMLIFrameElement)) {
      throw new Error('trezor-usb-permissions missing or incorrect dom type');
    }

    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          type: 'usb-permissions-init',
          extension: browser.runtime.id,
        },
        '*'
      );
    }

    return;
  }

  setTab();
});

window.addEventListener('beforeunload', setTab);

window.addEventListener('load', () => {
  const instance = document.createElement('iframe');

  instance.id = 'trezor-usb-permissions';
  instance.width = '100%';
  instance.height = '100%';

  instance.style.border = '0px';
  instance.style.width = '100%';
  instance.style.height = '100%';

  instance.setAttribute('src', `${url}extension-permissions.html`);
  instance.setAttribute('allow', 'usb');

  if (document.body) document.body.appendChild(instance);
});
