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
        filters: [{ vendorId: 0x534c }, { vendorId: 0x1209 }],
      });
      setStatus('USB permission granted. You can close this tab/window.');
      try {
        if (window.opener) {
          let openerOrigin = '*';
          try {
            if (document.referrer) {
              let url = new URL(document.referrer);
              openerOrigin = url.origin;
            }
          } catch (_) {
            openerOrigin = '*';
          }
          window.opener.postMessage(
            { type: 'trezor-usb-permission-granted' },
            openerOrigin
          );
        }
      } catch (_) {}
    } catch (e) {
      setStatus(e && e.message ? e.message : 'USB permission error', true);
    }
  }

  // Simple inline UI
  window.addEventListener('DOMContentLoaded', function () {
    let btn = document.createElement('button');
    btn.textContent = 'Grant USB permission';
    btn.style.cssText =
      'margin:16px;padding:8px 12px;border-radius:9999px;border:0;background:#2563eb;color:#fff;cursor:pointer;';
    btn.onclick = requestUsb;
    document.body.appendChild(btn);
    let p = document.createElement('p');
    p.id = 'status';
    p.style.cssText =
      'font:13px system-ui, sans-serif; color:#475569; margin-left:16px;';
    document.body.appendChild(p);
  });
})();
