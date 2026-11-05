// Public-fixture-only Chrome regression. No real device, account, or chain is used.
// Final runs require an absolute PALI_TEST_DAPP_EXTENSION_PATH and caller-supplied
// PALI_TEST_SOURCE_REVISION / PALI_TEST_SOURCE_DIFF_SHA256. PALI_TEST_BUILD_MANIFEST
// names an absolute JSON file { sourceRevision, sourceDiffSha256, files }, where
// files maps every relative build filename to its SHA256. Pin that file with
// PALI_TEST_BUILD_MANIFEST_SHA256. PALI_TEST_DIAGNOSTIC=1 explicitly waives source
// attribution for exploratory builds; it is not final source qualification.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('@playwright/test');
const { WebSocketServer } = require('ws');
const { utils } = require('syscoinjs-lib');

const PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'PublicFixture!2026';
const HARDWARE_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SOCKET_PORT = 21335; // The actual Connect 10 Suite Desktop discovery port.
const BACKEND_ORIGIN = 'https://blockbook.syscoin.org';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildInventory(root, relative = '') {
  const files = {};
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const entry = path.posix.join(relative, name);
    const stat = fs.lstatSync(path.join(root, entry));
    assert(!stat.isSymbolicLink(), 'Build inventory must not contain symlinks');
    if (stat.isDirectory()) Object.assign(files, buildInventory(root, entry));
    else {
      assert(stat.isFile(), 'Build inventory must contain only regular files');
      files[entry] = hash(fs.readFileSync(path.join(root, entry)));
    }
  }
  return files;
}

async function bounded(promise, label, timeout = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out: ${label}`)),
          timeout
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const build = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  assert(
    build && path.isAbsolute(build),
    'Set absolute PALI_TEST_DAPP_EXTENSION_PATH'
  );
  const diagnostic = process.env.PALI_TEST_DIAGNOSTIC === '1';
  const sourceRevision = process.env.PALI_TEST_SOURCE_REVISION || null;
  const sourceDiffSha256 = process.env.PALI_TEST_SOURCE_DIFF_SHA256 || null;
  const inventory = buildInventory(build);
  let buildManifestSha256 = null;
  if (!diagnostic) {
    assert(
      /^[0-9a-f]{40}$/.test(sourceRevision || ''),
      'Set PALI_TEST_SOURCE_REVISION for the built artifact'
    );
    assert(
      /^[0-9a-f]{64}$/.test(sourceDiffSha256 || ''),
      'Set PALI_TEST_SOURCE_DIFF_SHA256 for the built artifact'
    );
    const inventoryPath = process.env.PALI_TEST_BUILD_MANIFEST;
    assert(
      inventoryPath && path.isAbsolute(inventoryPath),
      'Set absolute PALI_TEST_BUILD_MANIFEST'
    );
    const expectedHash = process.env.PALI_TEST_BUILD_MANIFEST_SHA256;
    assert(
      /^[0-9a-f]{64}$/.test(expectedHash || ''),
      'Set PALI_TEST_BUILD_MANIFEST_SHA256'
    );
    const bytes = fs.readFileSync(inventoryPath);
    buildManifestSha256 = hash(bytes);
    assert.equal(
      buildManifestSha256,
      expectedHash,
      'Build manifest hash mismatch'
    );
    const expected = JSON.parse(bytes);
    assert.equal(expected.sourceRevision, sourceRevision);
    assert.equal(expected.sourceDiffSha256, sourceDiffSha256);
    assert.deepEqual(
      inventory,
      expected.files,
      'Complete build inventory mismatch'
    );
  }
  // A checkout HEAD cannot establish the provenance of an externally built tree.
  const provenance = {
    sourceAttribution: diagnostic
      ? 'unattributed-diagnostic-build'
      : 'caller-provided',
    sourceRevision,
    sourceDiffSha256,
    diagnosticCompositionOnly: diagnostic,
    buildManifestSha256,
    buildInventorySha256: hash(JSON.stringify(inventory)),
    buildFiles: Object.keys(inventory).length,
    backgroundSha256: hash(
      fs.readFileSync(path.join(build, 'js/background.bundle.js'))
    ),
    manifestSha256: hash(fs.readFileSync(path.join(build, 'manifest.json'))),
    harnessSha256: hash(fs.readFileSync(__filename)),
  };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(build, 'manifest.json'), 'utf8')
  );
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.externally_connectable?.matches, [
    'https://suite.trezor.io/*',
  ]);

  const hardware = new utils.HDSigner(HARDWARE_PHRASE, '', false);
  const xpub = hardware.getAccountXpub();
  hardware.createAccount();
  const secondXpub = hardware.getAccountXpub();
  const keys = [xpub, secondXpub];
  const counts = {
    connections: 0,
    closedConnections: 0,
    handshakes: 0,
    calls: 0,
    fixtureReads: 0,
    deniedHttp: 0,
    allowedConnect: 0,
  };
  const paths = [];
  const browserPages = [];
  const proxySockets = new Set();
  let context,
    profile,
    wss,
    proxy,
    heldReply,
    extensionId,
    holdNext = false,
    fixtureError;
  const healthy = () => {
    if (fixtureError) throw fixtureError;
  };
  const waitUntil = async (check, label) => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      healthy();
      if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
      await delay(25);
    }
    healthy();
  };
  let result;
  try {
    // Bind before Chrome starts. Failure to own this exact endpoint aborts the test.
    wss = new WebSocketServer({
      host: '127.0.0.1',
      port: SOCKET_PORT,
      path: '/connect-ws',
      maxPayload: 65536,
    });
    await bounded(
      once(wss, 'listening'),
      'owned Suite Desktop fixture listener'
    );
    wss.on('connection', (socket, request) => {
      if (request.headers.origin !== `chrome-extension://${extensionId}`) {
        fixtureError = new Error('Unexpected WebSocket fixture origin');
        socket.terminate();
        return;
      }
      counts.connections++;
      socket.on('close', () => counts.closedConnections++);
      socket.on('message', (bytes) => {
        try {
          const request = JSON.parse(bytes);
          if (request.type === 'popup-handshake') {
            counts.handshakes++;
            socket.send(
              JSON.stringify({
                id: request.id,
                type: request.type,
                payload: 'ok',
              })
            );
          } else if (request.type === 'iframe-call') {
            assert.equal(request.payload.method, 'getAccountInfo');
            assert.equal(request.payload.coin, 'sys');
            counts.calls++;
            assert(counts.calls <= 3, 'Unexpected additional hardware call');
            const expectedIndex = counts.calls === 1 ? 0 : 1;
            assert.equal(request.payload.path, `m/84'/57'/${expectedIndex}'`);
            paths.push(request.payload.path);
            const reply = () =>
              socket.send(
                JSON.stringify({
                  id: request.id,
                  success: true,
                  payload: {
                    descriptor: keys[expectedIndex],
                    balance: '0',
                    empty: true,
                    history: { total: 0, unconfirmed: 0 },
                  },
                  device: { features: { model: 'T3W1' } },
                })
              );
            if (holdNext) {
              holdNext = false;
              heldReply = reply;
            } else reply();
          } else if (request.type === 'ping') {
            socket.send(JSON.stringify({ id: request.id, success: true }));
          } else throw new Error('Unexpected Suite Desktop fixture message');
        } catch (error) {
          fixtureError = error;
          socket.terminate();
        }
      });
    });

    // Deny before the MV3 worker starts. Only our owned loopback WS is tunneled;
    // Chromium uses HTTP CONNECT for ws:// through an explicit HTTP proxy.
    proxy = http.createServer((_request, response) => {
      counts.deniedHttp++;
      response.writeHead(403);
      response.end();
    });
    proxy.on('connection', (socket) => {
      proxySockets.add(socket);
      // Chromium can reset a denied socket before reading the 403 response.
      // Observe every proxy socket, including those that never form a tunnel.
      socket.on('error', (error) => {
        if (!['ECONNRESET', 'EPIPE'].includes(error.code)) fixtureError = error;
      });
      socket.on('close', () => proxySockets.delete(socket));
    });
    proxy.on('connect', (request, socket, head) => {
      if (request.url !== `127.0.0.1:${SOCKET_PORT}`) {
        counts.deniedHttp++;
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      counts.allowedConnect++;
      const upstream = net.connect(SOCKET_PORT, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      proxySockets.add(upstream);
      upstream.on('close', () => {
        proxySockets.delete(upstream);
        socket.destroy();
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    });
    proxy.on('upgrade', (_request, socket) => {
      counts.deniedHttp++;
      socket.destroy();
    });
    proxy.listen(0, '127.0.0.1');
    await bounded(once(proxy, 'listening'), 'deny proxy listener');

    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-trezor-connect10-'));
    context = await chromium.launchPersistentContext(profile, {
      chromiumSandbox: true,
      headless: false,
      args: [
        '--headless=new',
        '--disable-quic',
        `--disable-extensions-except=${build}`,
        `--load-extension=${build}`,
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
      proxy: {
        server: `http://127.0.0.1:${proxy.address().port}`,
        bypass: '<-loopback>',
      },
      timeout: 30000,
    });
    context.on('page', (opened) => {
      browserPages.push(opened);
      opened.on('framenavigated', (frame) => {
        if (frame === opened.mainFrame() && /^https?:/.test(frame.url()))
          fixtureError = new Error('Unexpected external browser navigation');
      });
    });
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker', { timeout: 30000 }));
    extensionId = new URL(worker.url()).hostname;
    assert.equal(
      worker.url(),
      `chrome-extension://${extensionId}/js/background.bundle.js`
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`chrome-extension://${extensionId}/app.html#/`);
    await page.locator('#import-wallet-link').click();
    await page.locator('#import-wallet-input').fill(PHRASE);
    await page
      .locator('#import-wallet-action, button:has-text("Import")')
      .first()
      .click();
    await page.locator('#create-password').fill(PASSWORD);
    await page.locator('#confirm-password').fill(PASSWORD);
    await page
      .locator('#create-password-action, button:has-text("Next")')
      .first()
      .click();
    await page.waitForURL(/#\/home/, { timeout: 60000 });
    const state = () =>
      bounded(
        page.evaluate(
          () =>
            new Promise((resolve) => {
              chrome.runtime.sendMessage({ type: 'getCurrentState' }, (value) =>
                resolve({
                  hardware: Object.values(value.vault.accounts.Trezor).map(
                    (account) => ({
                      xpub: account.xpub,
                      address: account.address,
                    })
                  ),
                  network: value.vault.activeNetwork,
                })
              );
            })
        ),
        'read public fixture state'
      );
    const initial = await state();
    assert.equal(initial.network.currency, 'sys');
    assert.equal(initial.network.slip44, 57);
    assert.equal(new URL(initial.network.url).origin, BACKEND_ORIGIN);
    assert.equal(initial.hardware.length, 0);

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.origin === BACKEND_ORIGIN &&
        request.method() === 'GET' &&
        keys.some((key) => url.pathname === `/api/v2/xpub/${key}`) &&
        url.search === '?tokens=used&details=tokens' &&
        request.serviceWorker() === worker
      ) {
        counts.fixtureReads++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            address: url.pathname.split('/').pop(),
            balance: '0',
            unconfirmedBalance: '0',
            txs: 0,
            tokens: [],
          }),
        });
      } else await route.continue(); // The already installed proxy refuses this.
    });
    // Grant Chrome's real local-network permission, without changing its APIs.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Browser.grantPermissions', {
      origin: `chrome-extension://${extensionId}`,
      permissions: ['localNetworkAccess'],
    });
    const action = (method, params = [], timeout = 10000) =>
      bounded(
        page.evaluate(
          ({ method, params }) =>
            new Promise((resolve) =>
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', method], params },
                },
                resolve
              )
            ),
          { method, params }
        ),
        `controller ${method}`,
        timeout
      );

    const imported = await action('importTrezorAccountFromController', [
      'Public Trezor fixture',
    ]);
    assert(
      imported && !imported.error && imported.xpub === xpub,
      'Real controller import failed'
    );
    const first = await state();
    assert.equal(first.hardware.length, 1);
    assert.equal(first.hardware[0].xpub, xpub);
    assert.equal(counts.calls, 1);
    const pagesBeforeLock = context.pages().length;
    const createdBeforeLock = browserPages.length;

    holdNext = true;
    const pending = action('importTrezorAccountFromController', [
      'Public held Trezor fixture',
    ]);
    void pending.catch(() => undefined); // Cleanup may reject it before the held-reply assertion.
    await waitUntil(() => !!heldReply, 'held hardware reply');
    const lockStarted = Date.now();
    await action('lock', [], 2000);
    const lockElapsedMs = Date.now() - lockStarted;
    const cancelled = await pending;
    assert(
      cancelled?.error && cancelled.success === false,
      'Lock must reject pending import'
    );
    assert.equal(
      counts.closedConnections,
      0,
      'Lock must defer raw transport disposal'
    );
    assert.equal(await action('unlockFromController', [PASSWORD]), true);
    assert.deepEqual((await state()).hardware, first.hardware);
    const busyStarted = Date.now();
    const busy = await action(
      'importTrezorAccountFromController',
      ['Public busy Trezor fixture'],
      2000
    );
    const busyElapsedMs = Date.now() - busyStarted;
    assert.equal(busy?.success, false);
    assert.match(
      busy.error,
      /Finish or close the pending Trezor request in Trezor Suite/
    );
    assert.equal(
      counts.calls,
      2,
      'Busy state must not send another hardware request'
    );
    assert.equal(counts.connections, 1);

    heldReply();
    await waitUntil(
      () => counts.closedConnections === 1,
      'deferred cleanup after late reply'
    );
    assert.deepEqual(
      (await state()).hardware,
      first.hardware,
      'Late success must not create an account'
    );
    assert.equal(context.pages().length, pagesBeforeLock);
    assert.equal(
      browserPages.length,
      createdBeforeLock,
      'Deferred disposal must not open a fallback popup'
    );

    const reconnected = await action('importTrezorAccountFromController', [
      'Public reconnected Trezor fixture',
    ]);
    assert(
      reconnected && !reconnected.error && reconnected.xpub === secondXpub,
      'Reconnect import failed'
    );
    const final = await state();
    assert.deepEqual(
      final.hardware.map((account) => account.xpub).sort(),
      [...keys].sort()
    );
    assert.equal(counts.calls, 3);
    assert.equal(counts.connections, 2);
    assert.equal(counts.handshakes, 3);
    assert.equal(counts.fixtureReads, 2);
    assert.equal(context.pages().length, pagesBeforeLock);
    assert.equal(browserPages.length, createdBeforeLock);
    assert.deepEqual(
      buildInventory(build),
      inventory,
      'Build changed during qualification'
    );
    if (!diagnostic) {
      assert.equal(
        hash(fs.readFileSync(process.env.PALI_TEST_BUILD_MANIFEST)),
        buildManifestSha256,
        'Build manifest changed during qualification'
      );
    }
    healthy();
    result = {
      status: 'passed',
      scope:
        'trezor-connect10-real-extension-import-lock-busy-late-reply-reconnect',
      ...provenance,
      browser: context.browser().version(),
      node: process.versions.node,
      counts,
      paths,
      hardwareAccounts: final.hardware.length,
      lockElapsedMs,
      busyElapsedMs,
      localCancellationAndLateReplyFence: true,
      noDisposalInducedPopup: true,
      realOnboardingControllerStorageAndConnect: true,
      syntheticDesktopAndReadOnlyBackend: true,
      physicalDeviceQualified: false,
    };
  } finally {
    // Cleanup also runs on assertion failures; never retain/upload wallet profiles.
    let cleanupError;
    try {
      if (context) await bounded(context.close(), 'Chrome cleanup');
    } catch (error) {
      cleanupError = error;
    }
    for (const socket of proxySockets) socket.destroy();
    if (wss) {
      for (const socket of wss.clients) socket.terminate();
      try {
        await bounded(
          new Promise((resolve) => wss.close(resolve)),
          'WebSocket cleanup',
          5000
        );
      } catch (error) {
        cleanupError ||= error;
      }
    }
    if (proxy) {
      try {
        await bounded(
          new Promise((resolve) => proxy.close(resolve)),
          'proxy cleanup',
          5000
        );
      } catch (error) {
        cleanupError ||= error;
      }
    }
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  }
  console.log(JSON.stringify(result));
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      scope: 'trezor-connect10-public-fixture',
      error: error.message,
    })
  );
  process.exitCode = 1;
});
