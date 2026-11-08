const { Server } = require('ws');
const { createHash } = require('node:crypto');

/** This isolated loopback fixture never forwards messages to a relay. */
function walletConnectFixture(server, active) {
  const sockets = new Server({ noServer: true, maxPayload: 2048 });
  server.on('upgrade', (request, socket, head) => {
    const state = active();
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host}`);
    } catch {
      socket.destroy();
      return;
    }
    if (
      !state ||
      request.url.length > 8192 ||
      request.headers.host !== `127.0.0.1:${server.address().port}` ||
      ![`/${state.token}/wc-open`, `/${state.token}/wc-pending`].includes(
        url.pathname
      )
    ) {
      if (state) state.walletConnect.invalid++;
      socket.destroy();
      return;
    }
    const audit = state.walletConnect;
    if (url.pathname.endsWith('/wc-pending')) {
      audit.pending++;
      socket.once('close', () => {
        audit.pendingClosed++;
      });
      socket.once('end', () => socket.destroy());
      socket.resume();
      return;
    }
    audit.opened++;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      ws.once('close', () => {
        audit.closed++;
      });
      ws.on('error', () => {
        audit.invalid++;
      });
      ws.on('message', (bytes) => {
        try {
          const message = JSON.parse(bytes.toString());
          if (
            message.jsonrpc !== '2.0' ||
            ![
              'irn_subscribe',
              'irn_unsubscribe',
              'irn_batchSubscribe',
              'irn_publish',
            ].includes(message.method) ||
            !['number', 'string'].includes(typeof message.id)
          )
            throw Error('Unexpected request');
          audit.frames++;
          const id = createHash('sha256')
            .update(String(message.params?.topic ?? 'fixture'))
            .digest('hex');
          const result =
            message.method === 'irn_subscribe'
              ? id
              : message.method === 'irn_batchSubscribe'
              ? (message.params.topics ?? []).map(() => id)
              : true;
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        } catch {
          audit.invalid++;
          ws.close();
        }
      });
    });
  });
  return { inspect: () => ({ ...active().walletConnect }) };
}
const emptyWalletConnectAudit = () => ({
  opened: 0,
  closed: 0,
  pending: 0,
  pendingClosed: 0,
  frames: 0,
  invalid: 0,
});
module.exports = { walletConnectFixture, emptyWalletConnectAudit };
