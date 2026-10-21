import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'crypto';
import { AbiCoder, id } from 'ethers';
import fs from 'fs';
import path from 'path';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import { SPT_GUID, SPT_SYMBOL } from '../harness/sptFixture';
import { extensionEvidence } from '../harness/testDappConformance';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const CONTRACT = '0x000000000000000000000000000000000000ab71';
const SYMBOL = 'TABKEEP';

const tabTo = async (page: Page, control: Locator) => {
  for (let index = 0; index < 40; index += 1) {
    if (await control.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
};

const importedProjection = (page: Page, family: 'evm' | 'utxo') =>
  page.evaluate(
    async ({ family: kind, contract, guid }) => {
      const state = await chrome.runtime.sendMessage({
        type: 'getCurrentState',
      });
      const { id: accountId, type } = state.vault.activeAccount;
      const storageKey = `state-vault-${state.vaultGlobal.activeSlip44}`;
      const stored = await chrome.storage.local.get(storageKey);
      // Only public asset membership is inspected, never vault/key material.
      const hasTarget = (assets: any) => {
        const list =
          assets?.[type]?.[accountId]?.[
            kind === 'evm' ? 'ethereum' : 'syscoin'
          ] || [];
        return list.some((asset: any) =>
          kind === 'evm'
            ? asset.contractAddress?.toLowerCase() === contract
            : String(asset.assetGuid) === guid
        );
      };
      return {
        account: { id: accountId, type },
        chainId: state.vault.activeNetwork.chainId,
        live: hasTarget(state.vault.accountAssets),
        saved: hasTarget(stored[storageKey]?.accountAssets),
      };
    },
    { family, contract: CONTRACT, guid: SPT_GUID }
  );

(['evm', 'utxo'] as const).forEach((family) => {
  test(`${family.toUpperCase()} active custom-import tab preserves validated input for pointer and keyboard activation`, async ({}, info) => {
    expect(info.config.workers).toBe(1);
    expect(info.retry).toBe(0);
    expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
    expect(path.isAbsolute(E2E_CONFIG.extensionPath)).toBe(true);
    expect(E2E_CONFIG.extensionPath).toBe(
      process.env.PALI_TEST_DAPP_EXTENSION_PATH
    );
    const runtime = extensionEvidence();
    expect(runtime.sourceRevision).toBe(process.env.PALI_TEST_DAPP_REVISION);
    const sourceSha256 = createHash('sha256')
      .update(fs.readFileSync(info.file))
      .digest('hex');
    const previous = { ...E2E_CONFIG };
    const fixture = createIsolatedVaultFixture();
    const server = await startUtxoFixtureServer();
    Object.assign(E2E_CONFIG, {
      seedPhrase: UTXO_FIXTURE_SEED,
      password: 'TokenTabSynthetic!2026',
      rpcUrl: server.url,
      chainId: 5700,
      networkLabel:
        family === 'evm' ? 'Syscoin NEVM Testnet' : 'Syscoin Testnet',
    });
    let wallet: PaliWallet | undefined;
    let routes:
      | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
      | undefined;
    let status: 'passed' | 'failed' = 'failed';
    const deniedWrites: string[] = [];
    const tokenReads: string[] = [];
    const observations: Record<string, unknown> = {};
    try {
      wallet = await PaliWallet.launch(`token-import-active-tab-${family}`, {
        offlineHttpProxy: server.url,
        viewport: { width: 400, height: 620 },
      });
      routes = await installIsolatedVaultRoutes(
        wallet.context,
        fixture,
        server.url
      );
      if (family === 'evm') {
        const abi = AbiCoder.defaultAbiCoder();
        const replies = new Map([
          [
            id('name()').slice(0, 10),
            abi.encode(['string'], ['Synthetic tab token']),
          ],
          [id('symbol()').slice(0, 10), abi.encode(['string'], [SYMBOL])],
          [id('decimals()').slice(0, 10), abi.encode(['uint8'], [8])],
          [
            id('balanceOf(address)').slice(0, 10),
            abi.encode(['uint256'], ['123000000']),
          ],
          [
            id('totalSupply()').slice(0, 10),
            abi.encode(['uint256'], ['123000000']),
          ],
          [
            id('supportsInterface(bytes4)').slice(0, 10),
            abi.encode(['bool'], [false]),
          ],
        ]);
        await wallet.context.route(
          'https://rpc.tanenbaum.io/',
          async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            const body = route.request().postDataJSON();
            const calls = Array.isArray(body) ? body : [body];
            if (
              calls.some((call: any) =>
                /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
                  call?.method || ''
                )
              )
            ) {
              deniedWrites.push('write-or-sign');
              return route.abort('blockedbyclient');
            }
            const targetsToken = (call: any) =>
              String(call.params?.[0]?.to || call.params?.[0]).toLowerCase() ===
              CONTRACT;
            if (
              !calls.some(
                (call: any) =>
                  ['eth_call', 'eth_getCode'].includes(call.method) &&
                  targetsToken(call)
              )
            )
              return route.fallback();
            const values = calls.map((call: any) => {
              let result: unknown;
              if (call.method === 'eth_chainId') result = '0x1644';
              if (targetsToken(call)) {
                if (call.method === 'eth_getCode') result = '0x60006000fd';
                if (call.method === 'eth_call') {
                  const selector = String(call.params[0].data).slice(0, 10);
                  tokenReads.push(selector);
                  result = replies.get(selector);
                }
              }
              return result === undefined
                ? {
                    jsonrpc: '2.0',
                    id: call.id,
                    error: {
                      code: -32000,
                      message: 'Unsupported synthetic token read',
                    },
                  }
                : { jsonrpc: '2.0', id: call.id, result };
            });
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(Array.isArray(body) ? values : values[0]),
            });
          }
        );
      }
      const page = wallet.page;
      const value = family === 'evm' ? CONTRACT : SPT_GUID;
      const symbol = family === 'evm' ? SYMBOL : SPT_SYMBOL;
      const field = page.locator(
        family === 'evm' ? '#custom-token-contract' : '#custom-spt-guid'
      );
      const ownedTab = page.getByRole('button', {
        name: en.tokens.yourTokens,
        exact: true,
      });
      // The owned empty state may contain a second Add Custom action. Locate
      // the real header tab beside Your Tokens, never that empty-state CTA.
      const customTab = ownedTab.locator('..').getByRole('button', {
        name: en.tokens.addCustomTab,
        exact: true,
      });
      const previewImport = page.getByRole('button', {
        name: `Import ${symbol} token`,
        exact: true,
      });
      await wallet.step(
        `${family} prepare fenced wallet and open actual custom-import header tab`,
        async () => {
          await wallet!.importSeedAndCreatePassword();
          await wallet!.switchNetwork(
            family === 'evm' ? 'Syscoin NEVM Testnet' : 'Syscoin Testnet',
            family === 'evm' ? 'EVM' : 'UTXO'
          );
          await wallet!.ensureOnHome();
          observations.before = await importedProjection(page, family);
          expect(observations.before).toEqual({
            account: { id: 0, type: 'HDAccount' },
            chainId: 5700,
            live: false,
            saved: false,
          });
          await page.locator('#assets-btn').click();
          await page
            .getByRole('button', { name: en.home.importToken, exact: true })
            .click();
          await expect(ownedTab).toHaveCount(1);
          await expect(customTab).toHaveCount(1);
          await customTab.click();
          await field.fill(value);
          await expect(previewImport).toBeEnabled();
          if (family === 'evm') {
            expect(tokenReads).toContain(id('symbol()').slice(0, 10));
            expect(tokenReads).toContain(id('decimals()').slice(0, 10));
          } else {
            expect(routes!.reads.some((read) => read.includes('/asset'))).toBe(
              true
            );
          }
        }
      );
      await wallet.step(
        `${family} active-tab pointer Enter and Space preserve input and ready preview`,
        async () => {
          await customTab.click();
          await expect(field).toHaveValue(value);
          await expect(previewImport).toBeEnabled();
          await tabTo(page, customTab);
          await expect(customTab).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(field).toHaveValue(value);
          await expect(previewImport).toBeEnabled();
          await expect(customTab).toBeFocused();
          await page.keyboard.press('Space');
          await expect(field).toHaveValue(value);
          await expect(previewImport).toBeEnabled();
          observations.afterActiveTab = await importedProjection(page, family);
          expect(observations.afterActiveTab).toEqual(observations.before);
        }
      );
      await wallet.step(
        `${family} genuine owned-to-custom transition resets draft and validation can recover`,
        async () => {
          await ownedTab.click();
          await expect(field).toHaveCount(0);
          await customTab.click();
          await expect(field).toHaveValue('');
          await expect(previewImport).toHaveCount(0);
          await field.fill(value);
          await expect(previewImport).toBeEnabled();
          observations.afterRealSwitch = await importedProjection(page, family);
          expect(observations.afterRealSwitch).toEqual(observations.before);
        }
      );
      expect(deniedWrites).toEqual([]);
      expect(routes.deniedWrites).toEqual([]);
      status = 'passed';
    } finally {
      try {
        await info.attach(`${family}-active-tab-evidence`, {
          contentType: 'application/json',
          body: Buffer.from(
            JSON.stringify(
              {
                family,
                runtime,
                sourceSha256,
                status,
                observations,
                tokenReads,
                deniedWrites,
                networkReads: routes?.reads,
                fixtureDeniedWrites: routes?.deniedWrites,
              },
              null,
              2
            )
          ),
        });
      } finally {
        try {
          await wallet?.dispose(status);
        } finally {
          try {
            await server.close();
          } finally {
            Object.assign(E2E_CONFIG, previous);
          }
        }
      }
    }
  });
});
