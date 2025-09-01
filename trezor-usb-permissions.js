(function () {
  // If the view script isn't available, include a minimal handler
  function setStatus(text, isError) {
    let el = document.getElementById('status');
    if (el) {
      el.textContent = text || '';
      el.style.color = isError ? '#b91c1c' : '#475569';
    }
  }

  async function requestUsb() {
    try {
      if (!('usb' in navigator)) {
        setStatus('WebUSB not supported by this browser.', true);
        return;
      }
      await navigator.usb.requestDevice({
        filters: [
          { vendorId: 0x1209, productId: 0x53c0 }, // Trezor bootloader (WebUSB)
          { vendorId: 0x1209, productId: 0x53c1 }, // Trezor firmware (WebUSB)
        ],
      });
      setStatus('USB permission granted. You can close this tab/window.');
    } catch (e) {
      setStatus(e && e.message ? e.message : 'USB permission error', true);
    }
  }

  // Simple inline UI
  window.addEventListener('DOMContentLoaded', function () {
    let btn = document.getElementById('grant-btn');
    if (btn) {
      btn.addEventListener('click', requestUsb);
    }
  });
})();
