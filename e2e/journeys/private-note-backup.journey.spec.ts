import { expect, test, type Page } from '@playwright/test';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from 'crypto';
import fs from 'fs';
import path from 'path';
import { utils as sys } from 'syscoinjs-lib';

import packageJson from '../../package.json';
import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

// These publicly known synthetic notes have no deposits. Never fund them.
const NOTES = [
  `tornado-eth-0.1-1-0x${'01'.repeat(62)}`,
  `tornado-eth-1-1-0x${'02'.repeat(62)}`,
];
const FILE_PASSWORD = 'Public synthetic file password 2026';
const SOURCE_PASSWORD = 'PublicSourceWallet!2026';
const DESTINATION_PASSWORD = 'PublicDestinationWallet!2026';
const DESTINATION_SEED =
  'test test test test test test test test test test test junk';
const DATE = 1700000000000;
const copy = en.privacy.bundle;
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const summary = (added: number, duplicates: number, guarded: number) =>
  copy.summary
    .replace('{{added}}', String(added))
    .replace('{{duplicates}}', String(duplicates))
    .replace('{{guarded}}', String(guarded));

/** Independent classical Node implementation; does not invoke the production codec. */
function fixtureBackup(): Buffer {
  const plaintext = Buffer.from(
    JSON.stringify({
      format: 'pali-private-notes',
      version: 1,
      createdAt: DATE,
      notes: NOTES.map((note) => ({ note, createdAt: DATE })),
    })
  );
  const header = Buffer.alloc(64);
  header.write('PALINOTE', 0, 'ascii');
  header.set([1, 1, 1, 0], 8);
  randomBytes(32).copy(header, 12);
  randomBytes(12).copy(header, 44);
  header.writeUInt32BE(plaintext.length + 16, 56);
  const key = pbkdf2Sync(
    FILE_PASSWORD,
    header.subarray(12, 44),
    900000,
    32,
    'sha512'
  );
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(44, 56));
    cipher.setAAD(header);
    return Buffer.concat([
      header,
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  } finally {
    key.fill(0);
    plaintext.fill(0);
  }
}

/** Check actual downloaded bytes, retaining only public coverage evidence. */
function checkDownloaded(file: Buffer) {
  expect(file.length).toBeGreaterThan(80);
  expect(file.length).toBeLessThanOrEqual(8 * 1024 * 1024 + 80);
  expect(
    file
      .subarray(0, 12)
      .equals(Buffer.from([80, 65, 76, 73, 78, 79, 84, 69, 1, 1, 1, 0]))
  ).toBe(true);
  expect(file.readUInt32BE(56)).toBe(file.length - 64);
  expect(file.subarray(60, 64).every((value) => value === 0)).toBe(true);
  for (const text of [
    ...NOTES,
    FILE_PASSWORD,
    SOURCE_PASSWORD,
    DESTINATION_PASSWORD,
    UTXO_FIXTURE_SEED,
  ])
    expect(file.includes(Buffer.from(text))).toBe(false);
  const key = pbkdf2Sync(
    FILE_PASSWORD,
    file.subarray(12, 44),
    900000,
    32,
    'sha512'
  );
  let plaintext: Buffer | undefined;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      file.subarray(44, 56)
    );
    decipher.setAAD(file.subarray(0, 64));
    decipher.setAuthTag(file.subarray(-16));
    plaintext = Buffer.concat([
      decipher.update(file.subarray(64, -16)),
      decipher.final(),
    ]);
    const payload = JSON.parse(plaintext.toString('utf8'));
    expect(Object.keys(payload).join(',')).toBe(
      'format,version,createdAt,notes'
    );
    expect(payload.format).toBe('pali-private-notes');
    expect(payload.version).toBe(1);
    expect(Number.isSafeInteger(payload.createdAt)).toBe(true);
    expect(Array.isArray(payload.notes) && payload.notes.length === 2).toBe(
      true
    );
    // Compare hashes rather than emitting raw note values in assertion output.
    expect(
      hash(
        JSON.stringify(
          payload.notes.map((entry: { note: string }) => entry.note)
        )
      )
    ).toBe(hash(JSON.stringify(NOTES)));
    expect(
      payload.notes.every(
        (entry: any) =>
          Object.keys(entry).join(',') ===
            'note,createdAt,reconciliationRequired' &&
          entry.createdAt === DATE &&
          entry.reconciliationRequired === true
      )
    ).toBe(true);
    return {
      bytes: file.length,
      sha256: hash(file),
      noteCount: 2,
      pools: ['eth-0.1', 'eth-1'],
      independent900kAesGcmVerification: true,
      reconciliationMarkersPreserved: true,
    };
  } finally {
    key.fill(0);
    plaintext?.fill(0);
  }
}

async function privateStorage(page: Page) {
  return page.evaluate(async () => {
    const stored = await new Promise<Record<string, unknown>>((resolve) =>
      chrome.storage.local.get(null, resolve)
    );
    const entries = Object.entries(stored)
      .filter(([key]) => key.startsWith('state-private-vault-v1:'))
      .sort(([a], [b]) => a.localeCompare(b));
    const serialized = JSON.stringify(entries);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(serialized)
    );
    return {
      count: entries.length,
      sha256: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join(''),
      noPlaintextNotes: !serialized.includes('tornado-eth-'),
      profileSha256: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(entries.map(([key]) => key).join(','))
          )
        ),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join(''),
      canonicalEncryptedBundles: entries.every(
        ([, value]: [string, any]) =>
          value?.format === 'pali-private-note-vault' &&
          value.version === 1 &&
          value.root?.ciphertext &&
          Array.isArray(value.shards) &&
          value.shards.every(
            (shard: any) => typeof shard.ciphertext === 'string'
          )
      ),
    };
  });
}
async function noPlaintextUi(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.body.innerText.includes('tornado-eth-') ||
        [...document.querySelectorAll('textarea,input')].some((field) =>
          (field as HTMLInputElement).value.includes('tornado-eth-')
        )
    )
  ).toBe(false);
}
async function openPrivacy(wallet: PaliWallet) {
  await wallet.ensureOnHome();
  await wallet.page.locator('#general-settings-button').click();
  await wallet.page
    .getByRole('menuitem', { name: en.privacy.title, exact: true })
    .click();
  await expect(wallet.page).toHaveURL(/#\/privacy$/);
}
const closeDialog = async (page: Page) => {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: en.buttons.close, exact: true })
    .filter({ hasText: new RegExp(`^${en.buttons.close}$`) })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
};
const noteRows = (page: Page) =>
  page.locator('section[aria-labelledby="privacy-notes-title"] > ul > li');

test('private note files: real download, saved-file verification and fenced restore roundtrip', async () => {
  test.setTimeout(300000);
  const extensionPath = process.env.PALI_TEST_DAPP_EXTENSION_PATH;
  if (!extensionPath || !path.isAbsolute(extensionPath))
    throw new Error('Pin the exact built extension');
  if (!/^[a-f0-9]{40}$/i.test(process.env.PALI_TEST_DAPP_REVISION || ''))
    throw new Error('Pin the exact built source revision');
  const evidence = extensionEvidence();
  expect(evidence.version).toBe(packageJson.version);
  const before = { ...E2E_CONFIG };
  const fixture = createIsolatedVaultFixture();
  const fence = await startUtxoFixtureServer();
  const networkAudits: Awaited<
    ReturnType<typeof installIsolatedVaultRoutes>
  >[] = [];
  const seedFile = fixtureBackup();
  const observations: Record<string, unknown> = {};
  const screenshots: string[] = [];
  let wallet: PaliWallet | undefined;
  fs.mkdirSync(E2E_CONFIG.artifactsDir, { recursive: true });
  const qualificationManifest = path.resolve(
    extensionPath,
    '../../qualification-source.json'
  );
  const qualificationSourceSha256 = fs.existsSync(qualificationManifest)
    ? hash(fs.readFileSync(qualificationManifest))
    : undefined;
  if (qualificationSourceSha256)
    fs.copyFileSync(
      qualificationManifest,
      path.join(E2E_CONFIG.artifactsDir, 'qualification-source.json')
    );
  const downloadPath = path.join(
    E2E_CONFIG.artifactsDir,
    'private-notes-encrypted.palibak'
  );
  const configure = (password: string, seedPhrase = UTXO_FIXTURE_SEED) =>
    Object.assign(E2E_CONFIG, {
      extensionPath,
      seedPhrase,
      password,
      chainId: 5700,
      networkLabel: 'Syscoin Testnet',
      rpcUrl: fence.url,
    });
  const restorePreview = async (page: Page, filePath?: string) => {
    await page
      .getByRole('button', { name: copy.importTitle, exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: copy.importTitle,
      exact: true,
    });
    const picker = dialog.getByLabel(copy.selectFile, { exact: true });
    if (filePath) await picker.setInputFiles(filePath);
    else
      await picker.setInputFiles({
        name: 'public-fixture.palibak',
        mimeType: 'application/octet-stream',
        buffer: seedFile,
      });
    await dialog
      .getByLabel(copy.filePassword, { exact: true })
      .fill(FILE_PASSWORD);
    await dialog
      .getByRole('button', { name: copy.reviewImport, exact: true })
      .click();
    await Promise.race([
      dialog
        .getByRole('button', { name: copy.confirmRestore, exact: true })
        .waitFor({ state: 'visible', timeout: 120000 }),
      dialog
        .getByRole('alert')
        .waitFor({ state: 'visible', timeout: 120000 })
        .then(async () => {
          throw new Error(
            `Restore preview refused: ${await dialog
              .getByRole('alert')
              .innerText()}`
          );
        }),
    ]);
    await noPlaintextUi(page);
    return dialog;
  };
  const confirmRestore = async (
    page: Page,
    password: string,
    capture?: (targetPage: Page) => Promise<void>
  ) => {
    const dialog = page.getByRole('dialog', {
      name: copy.importTitle,
      exact: true,
    });
    await dialog
      .getByLabel(copy.walletPassword, { exact: true })
      .fill(password);
    await dialog
      .getByRole('button', { name: copy.confirmRestore, exact: true })
      .click();
    await expect(dialog.getByText(copy.restored, { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await noPlaintextUi(page);
    await capture?.(page);
    await closeDialog(page);
  };
  try {
    configure(SOURCE_PASSWORD);
    wallet = await PaliWallet.launch('private-note-backup-source', {
      offlineHttpProxy: fence.url,
      viewport: { width: 320, height: 480 },
    });
    networkAudits.push(
      await installIsolatedVaultRoutes(wallet.context, fixture, fence.url)
    );
    await wallet.step(
      'create a disposable fenced wallet and open private notes',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await openPrivacy(wallet!);
        expect((await privateStorage(wallet!.page)).count).toBe(0);
        await noPlaintextUi(wallet!.page);
      }
    );
    await wallet.step(
      'file preview cannot restore notes without fresh wallet authentication',
      async () => {
        const page = wallet!.page;
        const initial = await privateStorage(page);
        const dialog = await restorePreview(page);
        await expect(
          dialog.getByText(summary(2, 0, 2), { exact: true })
        ).toBeVisible();
        expect(await privateStorage(page)).toEqual(initial);
        await dialog
          .getByLabel(copy.walletPassword, { exact: true })
          .fill('WrongPublicPassword!2026');
        await dialog
          .getByRole('button', { name: copy.confirmRestore, exact: true })
          .click();
        await expect(
          dialog.getByText(copy.authentication, { exact: true })
        ).toBeVisible({ timeout: 120000 });
        expect(await privateStorage(page)).toEqual(initial);
        await closeDialog(page);
        const preview = await restorePreview(page);
        // Fault only the UI acknowledgment, after the real background commit.
        // The production controller, cryptography and storage stay untouched.
        await page.evaluate(() => {
          const runtime = chrome.runtime as any;
          const original = runtime.sendMessage;
          const probe = {
            commits: 0,
            replaced: 0,
            restore: () => {
              runtime.sendMessage = original;
            },
          };
          (globalThis as any).__paliBackupAckProbe = probe;
          runtime.sendMessage = (...args: any[]) => {
            const [message] = args;
            const index = args.length - 1;
            const callback = args[index];
            if (
              message?.data?.methods?.join('.') ===
                'noteBackups.commitImport' &&
              typeof callback === 'function'
            ) {
              probe.commits++;
              args[index] = (response: any) => {
                if (response?.confirmed === true) {
                  probe.replaced++;
                  callback({
                    success: false,
                    error: 'BACKUP_COMMIT_UNCONFIRMED',
                  });
                } else callback(response);
              };
            }
            return original.apply(runtime, args);
          };
        });
        try {
          await preview
            .getByLabel(copy.walletPassword, { exact: true })
            .fill(SOURCE_PASSWORD);
          await preview
            .getByRole('button', { name: copy.confirmRestore, exact: true })
            .click();
          await expect(
            preview.getByText(copy.unconfirmed, { exact: true })
          ).toBeVisible({ timeout: 120000 });
          screenshots.push(
            await wallet!.shot('backup-unconfirmed-before-dismissal-320x480')
          );
          await closeDialog(page);
          await expect(noteRows(page)).toHaveCount(2);
          const counts = await page.evaluate(() => {
            const scope = globalThis as any;
            const probe = scope.__paliBackupAckProbe;
            probe.restore();
            delete scope.__paliBackupAckProbe;
            return { commits: probe.commits, replaced: probe.replaced };
          });
          expect(counts).toEqual({ commits: 1, replaced: 1 });
          observations.lostCommitAcknowledgment = {
            ...counts,
            inventoryRefreshedAfterDismissal: true,
          };
        } finally {
          await page.evaluate(() => {
            const scope = globalThis as any;
            scope.__paliBackupAckProbe?.restore();
            delete scope.__paliBackupAckProbe;
          });
        }
        await expect(noteRows(page)).toHaveCount(2);
        observations.initialRestore = await privateStorage(page);
        expect(observations.initialRestore).toMatchObject({
          count: 1,
          noPlaintextNotes: true,
          canonicalEncryptedBundles: true,
        });
      }
    );
    await wallet.step(
      'export all pools only after fresh authentication and save the real browser download',
      async () => {
        const page = wallet!.page;
        const unchanged = await privateStorage(page);
        await page
          .getByRole('button', { name: copy.exportTitle, exact: true })
          .click();
        const dialog = page.getByRole('dialog', {
          name: copy.exportTitle,
          exact: true,
        });
        await dialog
          .getByLabel(copy.walletPassword, { exact: true })
          .fill('WrongPublicPassword!2026');
        await dialog
          .getByLabel(copy.filePassword, { exact: true })
          .fill(FILE_PASSWORD);
        await dialog
          .getByLabel(copy.confirmPassword, { exact: true })
          .fill(FILE_PASSWORD);
        await dialog
          .getByRole('button', { name: copy.createFile, exact: true })
          .click();
        await expect(
          dialog.getByText(copy.authentication, { exact: true })
        ).toBeVisible({ timeout: 120000 });
        await dialog
          .getByLabel(copy.walletPassword, { exact: true })
          .fill(SOURCE_PASSWORD);
        await dialog
          .getByLabel(copy.filePassword, { exact: true })
          .fill(FILE_PASSWORD);
        await dialog
          .getByLabel(copy.confirmPassword, { exact: true })
          .fill(FILE_PASSWORD);
        await dialog
          .getByRole('button', { name: copy.createFile, exact: true })
          .click();
        await expect(
          dialog.getByRole('button', { name: copy.saveFile, exact: true })
        ).toBeVisible({ timeout: 120000 });
        const countBounds = await dialog
          .getByText(copy.exportReady.replace('{{count}}', '2'), {
            exact: true,
          })
          .evaluate((element) => {
            const body = element.closest('div.overflow-y-auto');
            if (!body) throw new Error('Missing dialog scroll body');
            const count = element.getBoundingClientRect();
            const visible = body.getBoundingClientRect();
            return {
              top: count.top,
              bottom: count.bottom,
              visibleTop: visible.top,
              visibleBottom: visible.bottom,
            };
          });
        expect(countBounds.top).toBeGreaterThanOrEqual(countBounds.visibleTop);
        expect(countBounds.bottom).toBeLessThanOrEqual(
          countBounds.visibleBottom
        );
        await expect(dialog).not.toContainText('&#x2F;');
        screenshots.push(
          await wallet!.shot('backup-ready-before-save-320x480')
        );
        expect(await privateStorage(page)).toEqual(unchanged);
        await noPlaintextUi(page);
        const downloaded = page.waitForEvent('download');
        await dialog
          .getByRole('button', { name: copy.saveFile, exact: true })
          .click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe('pali-private-notes.palibak');
        await download.saveAs(downloadPath);
        expect(await download.failure()).toBeNull();
        await expect(
          dialog.getByText(copy.handoff, { exact: true })
        ).toBeVisible();
        screenshots.push(await wallet!.shot('backup-browser-handoff-320x480'));
        observations.download = checkDownloaded(fs.readFileSync(downloadPath));
      }
    );
    await wallet.step(
      'reselect the saved download and verify it without changing encrypted custody',
      async (capture) => {
        const page = wallet!.page;
        const unchanged = await privateStorage(page);
        const dialog = page.getByRole('dialog', {
          name: copy.exportTitle,
          exact: true,
        });
        await dialog
          .getByLabel(copy.selectFile, { exact: true })
          .setInputFiles(downloadPath);
        await dialog
          .getByLabel(copy.filePassword, { exact: true })
          .fill('WrongFilePassword!2026');
        await dialog
          .getByRole('button', { name: copy.verifyFile, exact: true })
          .click();
        await expect(
          dialog.getByText(copy.fileInvalid, { exact: true })
        ).toBeVisible({ timeout: 120000 });
        expect(await privateStorage(page)).toEqual(unchanged);
        await dialog
          .getByLabel(copy.filePassword, { exact: true })
          .fill(FILE_PASSWORD);
        screenshots.push(
          await wallet!.shot('backup-selected-file-before-verification-320x480')
        );
        await dialog
          .getByRole('button', { name: copy.verifyFile, exact: true })
          .click();
        await expect(
          dialog.getByText(copy.verified, { exact: true })
        ).toBeVisible({ timeout: 120000 });
        screenshots.push(await wallet!.shot('backup-file-verified-320x480'));
        expect(await privateStorage(page)).toEqual(unchanged);
        observations.verificationLeftCustodyUnchanged = true;
        await noPlaintextUi(page);
        await capture(page);
        await closeDialog(page);
      }
    );
    await wallet.dispose('passed');
    wallet = undefined;
    configure(DESTINATION_PASSWORD, DESTINATION_SEED);
    wallet = await PaliWallet.launch('private-note-backup-restored', {
      offlineHttpProxy: fence.url,
      viewport: { width: 320, height: 480 },
    });
    const destinationSigner = new sys.HDSigner(DESTINATION_SEED, '', true);
    const destinationXpub = destinationSigner.getAccountXpub();
    const destinationKey = destinationSigner.deriveKeypair("m/84'/1'/0'/0/0");
    const destinationAddress = sys.bitcoinjs.payments.p2wpkh({
      pubkey: destinationKey.publicKey,
      network: sys.syscoinNetworks.testnet,
    }).address!;
    networkAudits.push(
      await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        fence.url,
        (url) => {
          if (
            ![
              'https://blockbook-dev.syscoin.org',
              'https://explorer-blockbook-dev.syscoin.org',
            ].includes(url.origin)
          )
            return undefined;
          const match = url.pathname.match(
            /^\/api\/v2\/(xpub|address|utxo)\/(.+)$/
          );
          if (
            !match ||
            ![destinationXpub, destinationAddress].includes(
              decodeURIComponent(match[2])
            )
          )
            return undefined;
          if (match[1] === 'utxo') return [];
          return {
            address: decodeURIComponent(match[2]),
            balance: '0',
            unconfirmedBalance: '0',
            totalReceived: '0',
            totalSent: '0',
            txs: 0,
            unconfirmedTxs: 0,
            usedTokens: 0,
            tokens: [],
            tokensAsset: [],
          };
        }
      )
    );
    await wallet.step(
      'restore the downloaded file into a wallet with a different seed and password',
      async (capture) => {
        const page = wallet!.page;
        await wallet!.importSeedAndCreatePassword();
        await openPrivacy(wallet!);
        expect((await privateStorage(page)).count).toBe(0);
        const dialog = await restorePreview(page, downloadPath);
        await expect(
          dialog.getByText(summary(2, 0, 2), { exact: true })
        ).toBeVisible();
        await expect(
          dialog.getByText(copy.reconciliation, { exact: true })
        ).toBeVisible();
        screenshots.push(await wallet!.shot('backup-restore-preview-320x480'));
        await confirmRestore(page, DESTINATION_PASSWORD, capture);
        await expect(noteRows(page)).toHaveCount(2);
        observations.destinationRestore = await privateStorage(page);
        expect(observations.destinationRestore).toMatchObject({
          count: 1,
          noPlaintextNotes: true,
          canonicalEncryptedBundles: true,
        });
        expect(
          (observations.destinationRestore as { profileSha256: string })
            .profileSha256
        ).not.toBe(
          (observations.initialRestore as { profileSha256: string })
            .profileSha256
        );
        observations.differentSeedAndPasswordVerified = true;
      }
    );
    await wallet.step(
      'a repeated restore reports duplicates without creating extra notes',
      async (capture) => {
        const page = wallet!.page;
        const dialog = await restorePreview(page, downloadPath);
        await expect(
          dialog.getByText(summary(0, 2, 0), { exact: true })
        ).toBeVisible();
        await confirmRestore(page, DESTINATION_PASSWORD, capture);
        await expect(noteRows(page)).toHaveCount(2);
        await noPlaintextUi(page);
        observations.duplicateRestore = {
          added: 0,
          duplicates: 2,
          newOrUpdatedReconciliationHolds: 0,
          visibleNotes: 2,
        };
      }
    );
    for (const audit of networkAudits) expect(audit.deniedWrites).toEqual([]);
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'private-note-backup.json'),
      JSON.stringify(
        {
          ...evidence,
          qualificationSourceSha256,
          testSourceSha256: hash(fs.readFileSync(__filename)),
          simulated: true,
          actualChromiumDownload: true,
          actualSavedFileReselected: true,
          commitAcknowledgementFaultInjected: true,
          realProductionCryptoAndControllers: true,
          privateVaultOverridden: false,
          publicSyntheticFixturesOnly: true,
          plaintextInventoryReported: false,
          signaturesRequested: false,
          publicBroadcast: false,
          screenshots,
          observations,
          network: {
            deniedWrites: networkAudits.flatMap((audit) => audit.deniedWrites),
            readCount: networkAudits.reduce(
              (total, audit) => total + audit.reads.length,
              0
            ),
            proxyDeniedConnections: fence.blocked.length,
          },
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    throw error;
  } finally {
    seedFile.fill(0);
    Object.assign(E2E_CONFIG, before);
    await fence.close();
  }
});
