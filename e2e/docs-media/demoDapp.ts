import type { BrowserContext } from '@playwright/test';

// A polished demo dapp served via Playwright route interception so the
// connect popups show a real-looking origin instead of 127.0.0.1. No DNS or
// network is involved: the route fulfills the document before any request
// leaves the browser, while the extension still injects providers normally.
export const DEMO_DAPP_URL = 'https://demo.paliwallet.com/';

// EIP-712 payload used for the typed-data review screenshot. Mirrors the
// canonical "Ether Mail" example so the decoded fields look familiar.
const TYPED_DATA = {
  domain: {
    chainId: 57057,
    name: 'Pali Demo',
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
    version: '1',
  },
  message: {
    contents: 'Hi, Alice!',
    aNumber: 1337,
    from: { name: 'Bob', wallet: '0xB0B0000000000000000000000000000000000B0B' },
    to: { name: 'Alice', wallet: '0xA11CE00000000000000000000000000000A11CE0' },
  },
  primaryType: 'Mail',
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
      { name: 'aNumber', type: 'uint256' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
  },
};

const DAPP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Pali Demo Dapp</title>
<style>
  :root {
    --bg: #061120;
    --panel: #0c1a30;
    --card: rgba(255, 255, 255, 0.05);
    --border: rgba(255, 255, 255, 0.1);
    --text: #f5f7fb;
    --muted: #8d99ad;
    --blue: #4ca1cf;
    --pink: #ff3e91;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background:
      radial-gradient(640px 360px at 85% -10%, rgba(47, 107, 255, 0.22), transparent 60%),
      radial-gradient(520px 320px at -10% 110%, rgba(255, 62, 145, 0.12), transparent 60%),
      var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px;
  }
  .modal {
    width: 100%;
    max-width: 560px;
    background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), var(--panel);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 26px 26px 22px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  }
  .modal h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 0.01em;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .modal h1 .x { color: var(--muted); font-weight: 400; font-size: 18px; }
  .sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
  #providers { margin-top: 18px; display: flex; flex-direction: column; gap: 10px; }
  .provider {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 16px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .provider.detected { border-color: rgba(76, 161, 207, 0.55); }
  .provider img { width: 38px; height: 38px; border-radius: 10px; }
  .provider .meta { flex: 1; }
  .provider .name { font-size: 15px; font-weight: 600; }
  .provider .rdns { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .badge {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 4px 9px;
    border-radius: 999px;
    background: rgba(76, 161, 207, 0.16);
    color: var(--blue);
    border: 1px solid rgba(76, 161, 207, 0.4);
  }
  .badge.pink { background: rgba(255, 62, 145, 0.14); color: var(--pink); border-color: rgba(255, 62, 145, 0.4); }
  .footnote { margin-top: 16px; font-size: 11.5px; color: var(--muted); text-align: center; }
  .footnote code { color: var(--blue); font-family: ui-monospace, Menlo, monospace; }
  .actions { margin-top: 18px; display: none; grid-template-columns: 1fr 1fr; gap: 10px; }
  button.action {
    appearance: none;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    padding: 11px 10px;
    border-radius: 12px;
    cursor: pointer;
  }
  #out {
    display: none;
    margin-top: 14px;
    padding: 10px 12px;
    font: 11px ui-monospace, Menlo, monospace;
    color: var(--muted);
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid transparent;
    border-radius: 10px;
    word-break: break-all;
    white-space: pre-wrap;
  }
  #out.ok, #out.err {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 16px;
  }
  #out.ok {
    border-color: rgba(88, 214, 163, 0.45);
    background: rgba(88, 214, 163, 0.1);
  }
  #out.err {
    color: #ff7eb3;
    border-color: rgba(255, 62, 145, 0.4);
    background: rgba(255, 62, 145, 0.07);
  }
  .ok-banner { display: flex; align-items: center; gap: 12px; }
  .ok-check {
    flex: 0 0 auto;
    width: 30px; height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, #34d399, #10b981);
    color: #04130d;
    font-size: 18px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 16px rgba(16, 185, 129, 0.45);
  }
  .ok-title { font-size: 15px; font-weight: 700; color: #7df2bf; }
  .ok-sub {
    margin-top: 10px;
    font: 10.5px ui-monospace, Menlo, monospace;
    color: var(--muted);
    word-break: break-all;
    line-height: 1.5;
  }
  body.debug .actions { display: grid; }
  body.debug #out { display: block; }
</style>
</head>
<body>
  <div class="modal">
    <h1>Connect a wallet <span class="x">&#10005;</span></h1>
    <div class="sub">Providers discovered live through EIP&#8209;6963 announcements.</div>
    <div id="providers"></div>
    <div class="actions">
      <button class="action" id="connect">Connect</button>
      <button class="action" id="sign-typed">Sign typed data</button>
      <button class="action" id="send-calls">Batch (sendCalls)</button>
      <button class="action" id="smart-account">Create smart account</button>
      <button class="action" id="utxo-connect">UTXO connect</button>
      <button class="action" id="personal-sign">Personal sign</button>
    </div>
    <pre id="out">idle</pre>
    <div class="footnote">Listening for <code>eip6963:announceProvider</code> &mdash; any EIP&#8209;6963 wallet shows up here automatically.</div>
  </div>
<script>
  const TYPED_DATA = ${JSON.stringify(TYPED_DATA)};
  const out = document.getElementById('out');
  // Friendly success titles per action so the result reads as a clear "done"
  // state on camera instead of a raw JSON blob.
  const SUCCESS_TITLES = {
    'smart-account': 'Smart account ready',
    'send-calls': 'Batch executed',
    connected: 'Wallet connected',
    'typed-signed': 'Message signed',
    signed: 'Message signed',
    'utxo-connected': 'Wallet connected',
  };
  const report = (label, value) => {
    const isError = label.indexOf('error') >= 0;
    out.className = isError ? 'err' : 'ok';
    if (isError) {
      out.textContent = '\\u2715 ' + label + ': ' + value;
      return;
    }
    const title = SUCCESS_TITLES[label] || 'Success';
    // Keep "<label>:" in the rendered text so the capture harness can still
    // detect success by reading the result node's text content.
    const detail = label + ':' + String(value).slice(0, 170);
    out.innerHTML =
      '<div class="ok-banner"><div class="ok-check">\\u2713</div>' +
      '<div class="ok-title">' + title + '</div></div>' +
      '<div class="ok-sub">' + detail + '</div>';
  };
  const providersEl = document.getElementById('providers');
  const seen = new Set();

  window.addEventListener('eip6963:announceProvider', (event) => {
    const info = event.detail && event.detail.info;
    if (!info || seen.has(info.uuid)) return;
    seen.add(info.uuid);
    const row = document.createElement('div');
    row.className = 'provider detected';
    row.innerHTML =
      '<img src="' + info.icon + '" alt="" />' +
      '<div class="meta"><div class="name">' + info.name + '</div>' +
      '<div class="rdns">' + info.rdns + '</div></div>' +
      '<span class="badge">Detected</span>';
    providersEl.prepend(row);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  // Static rows so the picker reads as a real multi-wallet modal.
  const ghost = (name, hint, svg) => {
    const row = document.createElement('div');
    row.className = 'provider';
    row.innerHTML =
      '<img src="data:image/svg+xml;base64,' + btoa(svg) + '" alt="" />' +
      '<div class="meta"><div class="name">' + name + '</div>' +
      '<div class="rdns">' + hint + '</div></div>' +
      '<span class="badge pink">Other</span>';
    providersEl.append(row);
  };
  const tile = (bg, glyph) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="16" fill="' + bg + '"/>' +
    '<text x="32" y="41" font-family="-apple-system,Segoe UI,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">' + glyph + '</text></svg>';
  ghost('WalletConnect', 'qr-code &middot; mobile wallets', tile('#3396ff', 'W'));
  ghost('Browser wallet', 'window.ethereum fallback', tile('#37445e', '&#9679;'));

  document.getElementById('connect').onclick = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      report('connected', accounts[0]);
    } catch (e) { report('connect-error', e && e.message); }
  };

  document.getElementById('personal-sign').onclick = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const sig = await window.ethereum.request({
        method: 'personal_sign',
        params: ['0x50616c6920446f637320e29c8d', accounts[0]],
      });
      report('signed', sig);
    } catch (e) { report('sign-error', e && e.message); }
  };

  document.getElementById('sign-typed').onclick = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const sig = await window.ethereum.request({
        method: 'eth_signTypedData_v4',
        params: [accounts[0], JSON.stringify(TYPED_DATA)],
      });
      report('typed-signed', sig);
    } catch (e) { report('typed-error', e && e.message); }
  };

  document.getElementById('send-calls').onclick = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      // Two native transfers back to the account itself: simulation passes
      // (green checks in the review) and the bundle is a real atomic userop.
      const self = accounts[0];
      const result = await window.ethereum.request({
        method: 'wallet_sendCalls',
        params: [{
          atomicRequired: true,
          calls: [
            { to: self, value: '0x2386f26fc10000' },
            { to: self, value: '0x470de4df820000' },
          ],
          chainId,
          from: self,
          version: '2.0.0',
        }],
      });
      report('send-calls', JSON.stringify(result));
    } catch (e) { report('send-calls-error', e && e.message); }
  };

  document.getElementById('smart-account').onclick = async () => {
    try {
      const result = await window.ethereum.request({
        method: 'wallet_prepareSmartAccount',
        params: [{ label: 'Demo Passkey Account' }],
      });
      report('smart-account', JSON.stringify(result));
    } catch (e) { report('smart-account-error', e && e.message); }
  };

  document.getElementById('utxo-connect').onclick = async () => {
    try {
      const accounts = await window.pali.request({ method: 'sys_requestAccounts' });
      report('utxo-connected', JSON.stringify(accounts));
    } catch (e) { report('utxo-error', e && e.message); }
  };
</script>
</body>
</html>`;

// Routes the demo origin inside the given context. Idempotent per context.
export const installDemoDapp = async (context: BrowserContext) => {
  await context.route(`${DEMO_DAPP_URL}**`, (route) =>
    route.fulfill({
      body: DAPP_HTML,
      contentType: 'text/html',
      status: 200,
    })
  );
};
