// Real Chrome public-fixture regression. It never grants a device or signs.
// Pin the complete built artifact with the same manifest contract as the
// trezorConnect10 runner; diagnostic mode is explicitly not qualification.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const PHRASE = 'test test test test test test test test test test test junk';
const PASSWORD = 'PublicFixture!2026';
function inventory(root, relative = '') {
  const files = {};
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    const entry = path.posix.join(relative, name);
    const stat = fs.lstatSync(path.join(root, entry));
    assert(!stat.isSymbolicLink(), 'No symlinks in a qualified build');
    if (stat.isDirectory()) Object.assign(files, inventory(root, entry));
    else {
      assert(stat.isFile());
      files[entry] = hash(fs.readFileSync(path.join(root, entry)));
    }
  }
  return files;
}
async function bounded(promise, label, timeout = 15000) {
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
  assert(build && path.isAbsolute(build), 'Set absolute extension build path');
  const diagnostic = process.env.PALI_TEST_DIAGNOSTIC === '1';
  const sourceRevision = process.env.PALI_TEST_SOURCE_REVISION || null;
  const sourceDiffSha256 = process.env.PALI_TEST_SOURCE_DIFF_SHA256 || null;
  const files = inventory(build);
  let manifestHash = null;
  if (!diagnostic) {
    assert(/^[0-9a-f]{40}$/.test(sourceRevision || ''));
    assert(/^[0-9a-f]{64}$/.test(sourceDiffSha256 || ''));
    const manifestPath = process.env.PALI_TEST_BUILD_MANIFEST;
    assert(manifestPath && path.isAbsolute(manifestPath));
    manifestHash = hash(fs.readFileSync(manifestPath));
    assert.equal(manifestHash, process.env.PALI_TEST_BUILD_MANIFEST_SHA256);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    assert.equal(manifest.sourceRevision, sourceRevision);
    assert.equal(manifest.sourceDiffSha256, sourceDiffSha256);
    assert.deepEqual(
      files,
      manifest.files,
      'Complete build inventory mismatch'
    );
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pali-ledger-host-'));
  const errors = [];
  const sockets = new Set();
  const proxy = http.createServer((_, response) => {
    response.writeHead(403);
    response.end();
  });
  proxy.on('connect', (_, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {}); // Denied browser requests may reset their socket.
    socket.on('close', () => sockets.delete(socket));
  });
  let context;
  try {
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    context = await chromium.launchPersistentContext(profile, {
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
    });
    context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message))
    );
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const base = `chrome-extension://${new URL(worker.url()).hostname}`;
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.goto(`${base}/app.html#/`);
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
    const action = (method, params = []) =>
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
        method
      );
    const assertNoHardware = async () => {
      const count = await page.evaluate(
        () =>
          new Promise((resolve) =>
            chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) =>
              resolve(Object.keys(state.vault.accounts.Ledger).length)
            )
          )
      );
      assert.equal(count, 0, 'Cancelled request must not create an account');
    };
    const rejectedPage = async (url) => {
      const rejected = await context.newPage();
      await rejected.goto(url);
      await rejected
        .waitForFunction(() =>
          document
            .querySelector('#status')
            ?.textContent?.includes('Disconnected')
        )
        .catch(async (error) => {
          console.error(
            JSON.stringify({
              hostStatus: await rejected.locator('#status').textContent(),
              connectDisabled: await rejected.locator('#connect').isDisabled(),
              pageErrors: errors,
            })
          );
          throw error;
        });
      assert.equal(await rejected.locator('#connect').isDisabled(), true);
      await rejected.close();
    };
    await rejectedPage(`${base}/ledger.html#${'0'.repeat(48)}`);
    const startImport = async () => {
      const created = context.waitForEvent('page');
      const pending = action('importLedgerAccountFromController');
      void pending.catch(() => undefined);
      const device = await created;
      await device.waitForLoadState('domcontentloaded');
      await device.waitForFunction(
        () => !document.querySelector('#connect')?.disabled
      );
      return { device, pending };
    };
    const first = await startImport();
    const firstUrl = first.device.url();
    await rejectedPage(firstUrl); // Correct nonce copied into the wrong window.
    assert.equal(await first.device.locator('#connect').isEnabled(), true);
    await first.device.close();
    assert((await first.pending)?.error, 'Closing the host must reject import');
    await assertNoHardware();

    const second = await startImport();
    assert.notEqual(
      second.device.url(),
      firstUrl,
      'Each new session needs a fresh nonce'
    );
    await rejectedPage(firstUrl); // A previously owned nonce cannot be reused.
    const closed = second.device.waitForEvent('close');
    const lockStarted = Date.now();
    await action('lock');
    await closed;
    const lockElapsedMs = Date.now() - lockStarted;
    assert(
      (await second.pending)?.error,
      'Lock must reject the pending request'
    );
    assert.equal(await action('unlockFromController', [PASSWORD]), true);
    await assertNoHardware();

    const third = await startImport();
    assert.notEqual(third.device.url(), second.device.url());
    await third.device.close();
    assert((await third.pending)?.error);
    await assertNoHardware();
    assert.deepEqual(errors, [], 'Unexpected page error');
    assert.deepEqual(inventory(build), files, 'Build changed during test');
    if (!diagnostic)
      assert.equal(
        hash(fs.readFileSync(process.env.PALI_TEST_BUILD_MANIFEST)),
        manifestHash
      );
    console.log(
      JSON.stringify(
        {
          status: 'passed',
          scope: 'ledger-host-real-chrome-origin-window-close-lock-reconnect',
          diagnostic,
          sourceRevision,
          sourceDiffSha256,
          buildManifestSha256: manifestHash,
          buildInventorySha256: hash(JSON.stringify(files)),
          harnessSha256: hash(fs.readFileSync(__filename)),
          browser: context.browser().version(),
          node: process.versions.node,
          lockElapsedMs,
          deviceRequests: 3,
          importedAccounts: 0,
          publicNetworkBlocked: true,
          physicalDeviceQualification: false,
        },
        null,
        2
      )
    );
  } finally {
    await context?.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => proxy.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
