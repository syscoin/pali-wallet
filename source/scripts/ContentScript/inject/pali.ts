import { PaliInpageProviderSys } from './paliProviderSyscoin';
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Read files in as strings
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    pali: Readonly<any>;
    paliAlert: Readonly<any>;
  }
}

window.pali = new PaliInpageProviderSys();

// Notification helper
const buildPaliAlert = function() {
  const notification = document.createElement('div');

  // Style the notification
  notification.style.position = 'fixed';
  notification.style.top = '0';
  notification.style.right = '0';
  notification.style.width = '50%';
  notification.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
  notification.style.color = '#fff';
  notification.style.padding = '10px';
  notification.style.fontFamily = 'Arial, sans-serif';
  notification.style.fontSize = '12px';
  notification.style.whiteSpace = 'nowrap';
  notification.style.overflow = 'hidden';
  notification.style.textOverflow = 'ellipsis';
  notification.style.zIndex = '9999'; // Set a high z-index value
  notification.style['pointer-events'] = 'none'; // Do not block elements below

  // Append the notification to the page
  document.body.appendChild(notification);

  let methods = {
    set: function(message) {
      notification.innerHTML = '<p>'+message+'</p>';
    },
    show: function() {
      notification.style.display = 'block';
    },
    hide: function() {
      notification.style.display = 'none';
    }
  }

  // Interactions
  return methods;
}

window.paliAlert = buildPaliAlert();