import http from 'http';

import type { AddressInfo } from 'net';

// Minimal local dapp used by the dapp journey: exercises the injected
// EIP-1193 provider (connect + personal_sign) and reports results into
// #out so the journey can assert on them.
const DAPP_HTML = `<!DOCTYPE html>
<html>
  <head><title>Pali E2E Dapp</title></head>
  <body>
    <h1>Pali E2E Dapp</h1>
    <button id="connect">Connect</button>
    <button id="sign">Sign message</button>
    <pre id="out">idle</pre>
    <script>
      const out = document.getElementById('out');
      const report = (label, value) => {
        out.textContent = label + ':' + value;
      };
      document.getElementById('connect').onclick = async () => {
        try {
          const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts',
          });
          report('connected', accounts[0]);
        } catch (error) {
          report('connect-error', error && error.message);
        }
      };
      document.getElementById('sign').onclick = async () => {
        try {
          const accounts = await window.ethereum.request({
            method: 'eth_accounts',
          });
          const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: ['0x50616c69204532452074657374', accounts[0]],
          });
          report('signed', signature);
        } catch (error) {
          report('sign-error', error && error.message);
        }
      };
    </script>
  </body>
</html>`;

export type DappServer = {
  close: () => Promise<void>;
  url: string;
};

export const startDappServer = async (): Promise<DappServer> => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(DAPP_HTML);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve())
  );
  const { port } = server.address() as AddressInfo;

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
    url: `http://127.0.0.1:${port}/`,
  };
};
