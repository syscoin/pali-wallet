import { expect, test, type Page, type Route } from '@playwright/test';
import { createHash } from 'crypto';
import { Interface, parseEther, toQuantity } from 'ethers';
import fs from 'fs';
import http from 'http';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import {
  advanceMerkleWork,
  createMerkleWork,
  hashPair,
} from '../../source/utils/privacy/merkle';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import { UTXO_FIXTURE_SEED } from '../harness/utxoFixture';

const RPC = 'https://ethereum-rpc.publicnode.com';
const SERVICE = 'https://sysnode.info/api/privacy/v1';
const POOL_ID = 'eth-1';
const POOL_ADDRESS = '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936';
const DEPLOYMENT_BLOCK = 9117609;
const BLOCK_NUMBER = 20000000;
const BLOCK_HASH = '0x' + '42'.repeat(32);
const BLOCK_TIMESTAMP = toQuantity(Math.floor(Date.now() / 1000) - 900);
const FUNDED_NOTE = `tornado-eth-1-1-0x${'00'.repeat(62)}`;
const SPENT_NOTE = `tornado-eth-1-1-0x${'01'.repeat(62)}`;
const FUNDED_COMMITMENT =
  '0x17731ee23dee1b3a01f4c667052b7898aee8db579cc49748d8fc798d4e769d58';
const SPENT_COMMITMENT =
  '0x2d707d9af99186d8fab88c82455e4af57221d7148440318e2de0039bc6ce7841';
const SPENT_NULLIFIER =
  '0x1247b27cdafda5cc981be564e7c1b992b711fc5393c137435574d875714e6638';
// Independent circomlibjs@0.1.7 Pedersen and MiMC vectors for two synthetic
// notes; these are not observed mainnet deposits. Never derive the expected
// root from the snapshot under test or from the RPC fixture's response.
const TWO_LEAF_ROOT =
  '0x220b4b81baca64b1efe6bbf6725960bfc2781f3af4886dccd44f9f0f8aba0dd2';
const TWO_LEAF_PAIR =
  '0x27a1f6c5b6b1ebc9ec4f31d830b137d81e689544b611e83486502c85e6c93d55';
const word = (value: number) => '0x' + value.toString(16).padStart(64, '0');
const ABI = new Interface([
  'function nextIndex() view returns (uint32)',
  'function getLastRoot() view returns (bytes32)',
  'function levels() view returns (uint32)',
  'function denomination() view returns (uint256)',
  'function isKnownRoot(bytes32 root) view returns (bool)',
]);

// Install this fence before MV3 starts. It never forwards CONNECT or HTTP
// traffic; BrowserContext routes below fulfill only explicitly allowed reads.
// Unlike the shared fence's count-only audit, preserve the early CONNECT host
// here so a startup Sysnode request cannot escape the pre-opt-in assertion.
async function startPrivacyFence() {
  const blocked: Array<{ method: string; target: string }> = [];
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Offline privacy fixture</title>');
      return;
    }
    blocked.push({ method: request.method || '', target: request.url || '' });
    response.writeHead(403);
    response.end('Offline fixture only');
  });
  server.on('connect', (request, socket) => {
    blocked.push({ method: 'CONNECT', target: request.url || '' });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE')
        server.emit('error', error);
      socket.destroy();
    });
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    blocked,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

const poolStatus = (page: Page) =>
  page
    .locator('section[aria-labelledby="privacy-pool-data-title"]')
    .getByRole('status');

async function openPrivacy(wallet: PaliWallet) {
  await wallet.page
    .getByRole('button', { name: en.generalMenu.generalOptions, exact: true })
    .click();
  await wallet.page
    .getByRole('menuitem', { name: en.privacy.title, exact: true })
    .click();
  await expect(wallet.page).toHaveURL(/#\/privacy$/);
}

// Read only the public cache to corroborate the visible claim. No runtime
// method, Redux state, controller result, IndexedDB row or browser API is replaced.
async function readPublicCache(page: Page) {
  return page.evaluate(
    (poolId) =>
      new Promise<any>((resolve, reject) => {
        const request = indexedDB.open('pali-public-privacy-pools', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['state', 'snapshots'], 'readonly');
          const state = tx.objectStore('state').get(poolId);
          const ready = tx.objectStore('snapshots').get(`${poolId}:ready`);
          const candidate = tx
            .objectStore('snapshots')
            .get(`${poolId}:candidate`);
          tx.oncomplete = () => {
            db.close();
            resolve({
              status: state.result?.status,
              ready: ready.result?.snapshot || null,
              candidate: candidate.result?.snapshot || null,
            });
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    POOL_ID
  );
}

async function auditEncryptedNotes(page: Page) {
  return page.evaluate(
    (secrets) =>
      new Promise<{ count: number; encryptedOnly: boolean }>((resolve) => {
        chrome.storage.local.get(null, (stored) => {
          const records = Object.entries(stored).filter(([key]) =>
            key.startsWith('state-private-vault-v1:')
          );
          const serialized = JSON.stringify(records);
          resolve({
            count: records.length,
            encryptedOnly:
              records.every(
                ([, value]) =>
                  value?.version === 1 &&
                  typeof value.ciphertext === 'string' &&
                  typeof value.nonce === 'string' &&
                  !('notes' in value)
              ) && secrets.every((secret) => !serialized.includes(secret)),
          });
        });
      }),
    [
      FUNDED_NOTE,
      SPENT_NOTE,
      FUNDED_COMMITMENT,
      SPENT_COMMITMENT,
      SPENT_NULLIFIER,
    ]
  );
}

test('privacy pool preparation verifies local note imports and preserves a good cache on corrupt data', async ({}, info) => {
  test.setTimeout(180_000);
  expect(info.config.workers).toBe(1);
  expect(info.retry).toBe(0);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  const runtime = extensionEvidence();
  const sourceSha256 = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .digest('hex');
  const snapshots: Array<{ mode: string; url: string }> = [];
  const rpcReads: Array<{ method: string; params: unknown[] }> = [];
  const deniedRequests: string[] = [];
  const screenshots: string[] = [];
  const observations: Record<string, unknown> = {};
  let server: Awaited<ReturnType<typeof startPrivacyFence>> | undefined;
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let mode: 'progress' | 'healthy' | 'corrupt' = 'progress';
  let knownRootCalls = 0;
  let finalAnchorHeld = false;
  let releaseFinalAnchor!: () => void;
  const finalAnchorGate = new Promise<void>((resolve) => {
    releaseFinalAnchor = resolve;
  });
  let status: 'passed' | 'failed' = 'failed';

  const capture = async (phase: string) => {
    for (const viewport of [
      { width: 400, height: 620 },
      { width: 320, height: 480 },
    ]) {
      await wallet!.page.setViewportSize(viewport);
      await poolStatus(wallet!.page).scrollIntoViewIfNeeded();
      await expect(poolStatus(wallet!.page)).toBeVisible();
      const file = await wallet!.shot(
        `privacy-${phase}-${viewport.width}x${viewport.height}`
      );
      screenshots.push(file);
      await info.attach(
        `privacy-${phase}-${viewport.width}x${viewport.height}`,
        {
          path: path.join(E2E_CONFIG.artifactsDir, file),
          contentType: 'image/png',
        }
      );
    }
  };
  const deny = async (route: Route, reason: string) => {
    deniedRequests.push(reason);
    await route.abort('blockedbyclient');
  };

  try {
    expect(hashPair(FUNDED_COMMITMENT, SPENT_COMMITMENT)).toBe(TWO_LEAF_PAIR);
    const work = advanceMerkleWork(
      createMerkleWork(),
      [FUNDED_COMMITMENT, SPENT_COMMITMENT],
      2
    );
    expect(work.complete).toBe(true);
    expect(work.root).toBe(TWO_LEAF_ROOT);
    server = await startPrivacyFence();
    Object.assign(E2E_CONFIG, {
      chainId: 1,
      networkLabel: 'Ethereum Mainnet',
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'PrivacyPoolSyntheticOnly!2026',
      rpcUrl: server.url,
    });
    wallet = await PaliWallet.launch('privacy-pool-sync', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const fixture = createIsolatedVaultFixture();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    const owns = (value: unknown) =>
      fixture.evmAddresses.some(
        (address) => address.toLowerCase() === String(value).toLowerCase()
      );

    await wallet.context.route(`${RPC}/**`, async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return deny(route, 'Invalid RPC JSON');
      }
      const calls = Array.isArray(payload) ? payload : [payload];
      if (route.request().method() !== 'POST' || !calls.length)
        return deny(route, 'Unexpected RPC HTTP method');
      const replies = await Promise.all(
        calls.map(async (call) => {
          if (call?.jsonrpc !== '2.0' || !Array.isArray(call.params))
            return undefined;
          let result: unknown;
          switch (call.method) {
            case 'eth_chainId':
              result = '0x1';
              break;
            case 'net_version':
              result = '1';
              break;
            case 'eth_blockNumber':
              result = toQuantity(BLOCK_NUMBER);
              break;
            case 'eth_gasPrice':
            case 'eth_maxPriorityFeePerGas':
              result = '0x3b9aca00';
              break;
            case 'eth_getBalance':
            case 'eth_getTransactionCount':
              if (!owns(call.params[0])) return undefined;
              result = '0x0';
              break;
            case 'eth_getCode':
              if (
                !owns(call.params[0]) &&
                String(call.params[0]).toLowerCase() !== POOL_ADDRESS
              )
                return undefined;
              result = '0x';
              break;
            case 'eth_getLogs':
              if (
                call.params.length !== 1 ||
                !call.params[0] ||
                typeof call.params[0] !== 'object'
              )
                return undefined;
              result = [];
              break;
            case 'eth_getBlockByNumber': {
              if (
                call.params.length !== 2 ||
                typeof call.params[1] !== 'boolean' ||
                (call.params[0] !== 'latest' &&
                  !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(call.params[0]))
              )
                return undefined;
              const height =
                call.params[0] === 'latest'
                  ? BLOCK_NUMBER
                  : Number(BigInt(call.params[0]));
              if (
                !Number.isSafeInteger(height) ||
                height < 0 ||
                height > BLOCK_NUMBER
              )
                return undefined;
              const hash = (number: number) =>
                number === BLOCK_NUMBER
                  ? BLOCK_HASH
                  : '0x' +
                    createHash('sha256')
                      .update(`synthetic-block-${number}`)
                      .digest('hex');
              result = {
                number: toQuantity(height),
                hash: hash(height),
                parentHash: hash(height - 1),
                nonce: '0x0000000000000000',
                timestamp: BLOCK_TIMESTAMP,
                difficulty: '0x0',
                gasLimit: '0x1c9c380',
                gasUsed: '0x0',
                miner: '0x' + '00'.repeat(20),
                extraData: '0x',
                transactions: [],
                baseFeePerGas: '0x3b9aca00',
              };
              break;
            }
            case 'eth_call': {
              if (
                call.params.length !== 2 ||
                String(call.params[0]?.to).toLowerCase() !== POOL_ADDRESS
              )
                return undefined;
              let parsed: ReturnType<Interface['parseTransaction']>;
              try {
                parsed = ABI.parseTransaction({ data: call.params[0].data });
              } catch {
                return undefined;
              }
              if (!parsed) return undefined;
              if (parsed.name === 'isKnownRoot') {
                if (
                  call.params[1] !== 'latest' ||
                  parsed.args[0] !== TWO_LEAF_ROOT
                )
                  return undefined;
                knownRootCalls += 1;
                if (mode === 'healthy' && knownRootCalls === 2) {
                  finalAnchorHeld = true;
                  await finalAnchorGate;
                }
                result = ABI.encodeFunctionResult('isKnownRoot', [true]);
              } else {
                if (call.params[1] !== toQuantity(BLOCK_NUMBER))
                  return undefined;
                const values: Record<string, unknown> = {
                  nextIndex: 2,
                  getLastRoot: TWO_LEAF_ROOT,
                  levels: 20,
                  denomination: parseEther('1'),
                };
                if (!(parsed.name in values)) return undefined;
                result = ABI.encodeFunctionResult(parsed.name, [
                  values[parsed.name],
                ]);
              }
              break;
            }
            default:
              return undefined;
          }
          rpcReads.push({ method: call.method, params: call.params });
          return { jsonrpc: '2.0', id: call.id, result };
        })
      );
      if (replies.some((reply) => reply === undefined))
        return deny(route, 'Unallowlisted RPC request');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(payload) ? replies : replies[0]),
      });
    });
    await wallet.context.route('https://api.routescan.io/**', async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() !== 'GET' ||
        url.pathname !== '/v2/network/mainnet/evm/1/etherscan/api' ||
        url.searchParams.get('module') !== 'account' ||
        !['txlist', 'tokentx', 'tokennfttx', 'token1155tx'].includes(
          url.searchParams.get('action') || ''
        ) ||
        !owns(url.searchParams.get('address'))
      )
        return deny(route, 'Unallowlisted explorer request');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: '1', message: 'OK', result: [] }),
      });
    });
    await wallet.context.route(`${SERVICE}/**`, async (route) => {
      const request = route.request();
      if (
        request.method() !== 'GET' ||
        request.url() !== `${SERVICE}/pools/${POOL_ID}/snapshot` ||
        request.postData() ||
        request.headers().cookie
      )
        return deny(route, 'Unallowlisted pool request');
      snapshots.push({ mode, url: request.url() });
      await route.fulfill({
        status: mode === 'progress' ? 202 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          mode === 'progress'
            ? {
                phase: 'syncing',
                startBlock: DEPLOYMENT_BLOCK,
                scannedBlock: DEPLOYMENT_BLOCK + 99,
                targetBlock: BLOCK_NUMBER,
              }
            : {
                version: 1,
                chainId: 1,
                poolAddress: POOL_ADDRESS,
                asOfBlockNumber: BLOCK_NUMBER,
                asOfBlockHash: BLOCK_HASH,
                leafCount: 2,
                withdrawnNullifiers: [SPENT_NULLIFIER],
                leaves: [
                  FUNDED_COMMITMENT,
                  mode === 'corrupt' ? word(3) : SPENT_COMMITMENT,
                ],
                root: TWO_LEAF_ROOT,
              }
        ),
      });
    });

    await wallet.step(
      'privacy: onboard a disposable fenced wallet and open the ordinary menu entry',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.ensureOnHome();
        await openPrivacy(wallet!);
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.idle);
        await expect(
          wallet!.page.getByRole('combobox', { name: en.privacy.poolLabel })
        ).toHaveValue('eth-0.1');
        expect(
          await wallet!.page.getByRole('option').allTextContents()
        ).toEqual(['0.1 ETH', '1 ETH', '10 ETH', '100 ETH']);
        expect(snapshots).toEqual([]);
        expect(
          server!.blocked.filter((entry) =>
            entry.target.includes('sysnode.info')
          )
        ).toEqual([]);
      }
    );
    await wallet.step(
      'privacy: select Ethereum mainnet through the normal network menu without starting a sync',
      async () => {
        await wallet!.page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await expect(wallet!.page).toHaveURL(/#\/home(?:\?.*)?$/);
        await wallet!.switchNetwork('Ethereum Mainnet', 'EVM');
        await openPrivacy(wallet!);
        await wallet!.page
          .getByRole('combobox', { name: en.privacy.poolLabel })
          .selectOption(POOL_ID);
        await expect(
          wallet!.page.getByRole('button', {
            name: en.privacy.prepare,
            exact: true,
          })
        ).toBeEnabled();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.idle);
        expect(snapshots).toEqual([]);
        expect(rpcReads.filter((read) => read.method === 'eth_call')).toEqual(
          []
        );
        expect(
          server!.blocked.filter((entry) =>
            entry.target.includes('sysnode.info')
          )
        ).toEqual([]);
        await capture('initial');
      }
    );
    await wallet.step(
      'privacy: explicit preparation downloads public pool data and exposes progress',
      async () => {
        await wallet!.page
          .getByRole('button', { name: en.privacy.prepare, exact: true })
          .click();
        await expect.poll(() => snapshots.length).toBeGreaterThan(0);
        await expect(poolStatus(wallet!.page)).toContainText(
          en.privacy.syncing
        );
        await expect(wallet!.page.getByRole('progressbar')).toBeVisible();
        await capture('progress');
      }
    );
    await wallet.step(
      'privacy: calculate the real two-leaf root and independently anchor it before ready',
      async () => {
        mode = 'healthy';
        await expect.poll(() => finalAnchorHeld, { timeout: 30000 }).toBe(true);
        await expect(poolStatus(wallet!.page)).toContainText(
          en.privacy.verifying
        );
        await capture('verifying');
        releaseFinalAnchor();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.ready);
        observations.verified = await readPublicCache(wallet!.page);
        expect(observations.verified).toMatchObject({
          status: { phase: 'ready', leafCount: 2, blockNumber: BLOCK_NUMBER },
          ready: {
            leaves: [FUNDED_COMMITMENT, SPENT_COMMITMENT],
            root: TWO_LEAF_ROOT,
            asOfBlockHash: BLOCK_HASH,
          },
          candidate: null,
        });
        expect(knownRootCalls).toBe(2);
        await capture('ready');
      }
    );
    await wallet.step(
      'privacy: pause scheduled updates without deleting verified data and resume explicitly',
      async () => {
        const alarmName = `privacy-pool-sync:${POOL_ID}`;
        const readAlarm = () =>
          wallet!.page.evaluate(
            (name) =>
              new Promise<chrome.alarms.Alarm | undefined>((resolve) =>
                chrome.alarms.get(name, resolve)
              ),
            alarmName
          );
        const scheduled = await readAlarm();
        expect(scheduled?.scheduledTime).toBeGreaterThan(Date.now());
        expect(scheduled!.scheduledTime - Date.now()).toBeLessThanOrEqual(
          15 * 60 * 1000
        );
        await wallet!.page
          .getByRole('button', { name: en.privacy.pause, exact: true })
          .click();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.paused);
        expect((await readPublicCache(wallet!.page)).ready).toEqual(
          (observations.verified as any).ready
        );
        await expect.poll(readAlarm).toBeUndefined();
        await wallet!.page
          .getByRole('button', { name: en.privacy.resume, exact: true })
          .click();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.ready);
        expect(knownRootCalls).toBe(4);
        expect(await readAlarm()).toBeDefined();
      }
    );
    await wallet.step(
      'privacy: notes require verified deposits and use encrypted custody with explicit backup reveal',
      async () => {
        const notes = wallet!.page.locator(
          'section[aria-labelledby="privacy-notes-title"]'
        );
        const readsBefore = snapshots.length;
        const importNote = async (value: string) => {
          await notes
            .getByRole('button', { name: en.privacy.importNote, exact: true })
            .click();
          await notes
            .getByRole('textbox', { name: en.privacy.noteLabel, exact: true })
            .fill(value);
          await notes
            .getByRole('button', { name: en.privacy.importNote, exact: true })
            .click();
          await expect(notes.locator('#privacy-import-form')).toHaveCount(0);
        };
        await importNote(FUNDED_NOTE);
        await expect(notes.getByRole('listitem')).toHaveCount(1);
        await expect(notes).toContainText(en.privacy.notePhase.verified);
        await importNote(FUNDED_NOTE);
        await expect(notes.getByRole('listitem')).toHaveCount(1);
        await importNote(SPENT_NOTE);
        await expect(notes.getByRole('listitem')).toHaveCount(2);
        await expect(notes).toContainText(en.privacy.notePhase.spent);
        expect(await auditEncryptedNotes(wallet!.page)).toEqual({
          count: 1,
          encryptedOnly: true,
        });
        observations.encryptedNotes = await auditEncryptedNotes(wallet!.page);

        await notes
          .getByRole('button', { name: en.privacy.importNote, exact: true })
          .click();
        await notes
          .getByRole('textbox', { name: en.privacy.noteLabel, exact: true })
          .fill(`tornado-eth-1-1-0x${'02'.repeat(62)}`);
        await notes
          .getByRole('button', { name: en.privacy.importNote, exact: true })
          .click();
        await expect(notes.getByRole('alert')).toContainText(
          en.privacy.noteNotFound
        );
        await expect(notes.getByRole('listitem')).toHaveCount(2);
        await notes
          .getByRole('button', { name: en.buttons.cancel, exact: true })
          .click();

        await notes
          .getByRole('listitem')
          .first()
          .getByRole('button', {
            name: en.privacy.revealNoteLabel.replace('{{amount}}', '1'),
          })
          .click();
        const password = notes.getByPlaceholder(en.settings.enterYourPassword);
        await password.fill('wrong-password');
        await notes
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        await expect(notes).toContainText(en.privacy.noteRevealFailed);
        await expect(notes.locator('#privacy-revealed-note')).toHaveCount(0);
        await password.fill(E2E_CONFIG.password);
        await notes
          .getByRole('button', { name: en.buttons.confirm, exact: true })
          .click();
        await expect(
          notes.getByRole('textbox', {
            name: en.privacy.privateNote,
            exact: true,
          })
        ).toHaveValue(FUNDED_NOTE);
        await notes
          .getByRole('button', { name: en.privacy.hideNote, exact: true })
          .click();
        await expect(notes.locator('#privacy-revealed-note')).toHaveCount(0);
        expect(snapshots.length).toBe(readsBefore);
        expect(JSON.stringify(rpcReads)).not.toContain(FUNDED_COMMITMENT);
        expect(JSON.stringify(rpcReads)).not.toContain(SPENT_NULLIFIER);
        for (const viewport of [
          { width: 400, height: 620 },
          { width: 320, height: 480 },
        ]) {
          await wallet!.page.setViewportSize(viewport);
          await notes.scrollIntoViewIfNeeded();
          screenshots.push(
            await wallet!.shot(
              `private-notes-${viewport.width}x${viewport.height}`
            )
          );
        }
        await wallet!.page.setViewportSize({ width: 400, height: 620 });
      }
    );
    await wallet.step(
      'privacy: a corrupt leaf fails local verification and retains the previously verified snapshot',
      async () => {
        mode = 'corrupt';
        await wallet!.page
          .getByRole('button', { name: en.privacy.refresh, exact: true })
          .click();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.error);
        const notes = wallet!.page.locator(
          'section[aria-labelledby="privacy-notes-title"]'
        );
        await notes
          .getByRole('button', { name: en.privacy.refreshNotes, exact: true })
          .click();
        await expect(
          notes.getByText(en.privacy.notePhase.waiting, { exact: true })
        ).toHaveCount(2);
        await expect(
          wallet!.page.getByRole('button', {
            name: en.privacy.retry,
            exact: true,
          })
        ).toBeEnabled();
        observations.rejected = await readPublicCache(wallet!.page);
        expect(observations.rejected).toMatchObject({
          status: {
            phase: 'error',
            errorCode: 'privacy_verification_failed',
            leafCount: 2,
            blockNumber: BLOCK_NUMBER,
          },
          ready: (observations.verified as any).ready,
        });
        expect((observations.rejected as any).ready).toEqual(
          (observations.verified as any).ready
        );
        expect(knownRootCalls).toBe(5); // First anchor passes; a corrupt local root never reaches the final anchor.
        await capture('error');
      }
    );
    await wallet.step(
      'privacy: clear public data and return through ordinary Back navigation',
      async () => {
        const readsBeforeClear = snapshots.length;
        await wallet!.page
          .getByRole('button', { name: en.privacy.clear, exact: true })
          .click();
        await expect(poolStatus(wallet!.page)).toContainText(en.privacy.idle);
        observations.cleared = await readPublicCache(wallet!.page);
        expect(observations.cleared).toEqual({
          status: { poolId: POOL_ID, phase: 'idle' },
          ready: null,
          candidate: null,
        });
        await wallet!.page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await expect(wallet!.page).toHaveURL(/#\/home(?:\?.*)?$/);
        await expect(wallet!.page.locator('#home-balance')).toBeVisible();
        expect(snapshots.length).toBe(readsBeforeClear);
        expect(routes!.deniedWrites).toEqual([]);
        expect(deniedRequests).toEqual([]);
        expect(extensionEvidence()).toEqual(runtime);
        expect(
          createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')
        ).toBe(sourceSha256);
      }
    );
    wallet.finding({
      severity: 'info',
      detail:
        'All pool, RPC and explorer replies were synthetic and fulfilled locally behind a launch-time deny proxy. The unmodified wallet computed the MiMC tree, checked independent RPC anchors and persisted public IndexedDB data. No mainnet deposit, withdrawal, signing or broadcast occurred.',
    });
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    releaseFinalAnchor();
    try {
      await info.attach('privacy-pool-sync-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            status,
            runtime,
            sourceSha256,
            syntheticResponsesOnly: true,
            controllerMutationsInjected: false,
            controllerResultsReplaced: false,
            indexDbRowsInjected: false,
            snapshots,
            rpcReads,
            deniedRequests,
            deniedWrites: routes?.deniedWrites,
            proxyBlocked: server?.blocked,
            screenshots,
            observations,
          },
          null,
          2
        ),
      });
    } finally {
      try {
        await wallet?.dispose(status);
      } finally {
        await server?.close();
        Object.assign(E2E_CONFIG, previous);
      }
    }
  }
});
