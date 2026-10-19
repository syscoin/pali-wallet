import { expect, test, type Page } from '@playwright/test';
import { AbiCoder, id } from 'ethers';

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

const CONTRACT = '0x000000000000000000000000000000000000e721';
const STORED_SYMBOL = 'STORED';

async function selectAccount(page: Page, accountId: number) {
  await page.locator('#general-settings-button').click();
  await page
    .locator(`#account-HDAccount-${accountId}`)
    .getByRole('menuitem')
    .first()
    .click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<{ id: number; switching: boolean }>((resolve) => {
            chrome.runtime.sendMessage(
              { type: 'getCurrentState' },
              ({ vault, vaultGlobal }) =>
                resolve({
                  id: vault.activeAccount.id,
                  switching: vaultGlobal.isSwitchingAccount,
                })
            );
          })
      )
    )
    .toEqual({ id: accountId, switching: false });
}

test('stale import previews do not return from a collection or replace the reopened asset in another account', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  const fixture = createIsolatedVaultFixture();
  const abi = AbiCoder.defaultAbiCoder();
  const selector = (signature: string) => id(signature).slice(0, 10);
  const reads: Array<{ method: string; phase: string }> = [];
  const deniedWrites: string[] = [];
  let phase: 'stored' | 'preview' = 'stored';
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const observations: unknown[] = [];
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'PreviewNavigationSynthetic!2026',
    rpcUrl: server.url,
  });
  try {
    wallet = await PaliWallet.launch('preview-navigation-context', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      fixture,
      server.url
    );
    // Only public ABI-encoded contract reads differ by fixture phase/account.
    // Wallet state, controller replies and signatures are never replaced.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const rpc = route.request().postDataJSON();
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign)/i.test(
            call?.method || ''
          )
        )
      ) {
        deniedWrites.push('attempted-write-or-sign');
        return route.abort('blockedbyclient');
      }
      if (
        !calls.some(
          (call: any) =>
            ['eth_call', 'eth_getCode'].includes(call?.method) &&
            (call.params?.[0]?.to || call.params?.[0])?.toLowerCase() ===
              CONTRACT
        )
      )
        return route.fallback();
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call?.method === 'eth_chainId') result = '0x1644';
        const target = (
          call?.params?.[0]?.to || call?.params?.[0]
        )?.toLowerCase();
        if (call?.method === 'eth_getCode' && target === CONTRACT)
          result = '0x60006000fd';
        if (call?.method === 'eth_call' && target === CONTRACT) {
          const data = call.params[0].data as string;
          const prefix = data.slice(0, 10);
          reads.push({ method: prefix, phase });
          if (prefix === selector('name()'))
            result = abi.encode(['string'], ['Synthetic Scoped Collection']);
          if (prefix === selector('symbol()'))
            result = abi.encode(['string'], [STORED_SYMBOL]);
          if (prefix === selector('supportsInterface(bytes4)')) {
            const [value] = abi.decode(['bytes4'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['bool'],
              [value === '0x80ac58cd' || value === '0x01ffc9a7']
            );
          }
          if (prefix === selector('balanceOf(address)')) {
            const [owner] = abi.decode(['address'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['uint256'],
              [
                owner.toLowerCase() === fixture.evmAddresses[1].toLowerCase()
                  ? '2'
                  : '1',
              ]
            );
          }
          if (prefix === selector('totalSupply()'))
            result = abi.encode(['uint256'], ['3']);
          if (prefix === selector('tokenOfOwnerByIndex(address,uint256)')) {
            const [owner, index] = abi.decode(
              ['address', 'uint256'],
              `0x${data.slice(10)}`
            );
            result = abi.encode(
              ['uint256'],
              [
                owner.toLowerCase() === fixture.evmAddresses[1].toLowerCase()
                  ? BigInt(index) + BigInt(10)
                  : BigInt(9),
              ]
            );
          }
          if (prefix === selector('tokenByIndex(uint256)')) {
            const [index] = abi.decode(['uint256'], `0x${data.slice(10)}`);
            result = abi.encode(['uint256'], [BigInt(index) + BigInt(9)]);
          }
          if (prefix === selector('ownerOf(uint256)')) {
            const [tokenId] = abi.decode(['uint256'], `0x${data.slice(10)}`);
            result = abi.encode(
              ['address'],
              [fixture.evmAddresses[String(tokenId) === '9' ? 0 : 1]]
            );
          }
          if (prefix === selector('tokenURI(uint256)'))
            result = abi.encode(['string'], ['']);
        }
        return result === undefined
          ? {
              jsonrpc: '2.0',
              id: call.id,
              error: { code: -32000, message: 'Unsupported synthetic read' },
            }
          : { jsonrpc: '2.0', id: call.id, result };
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(rpc) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    const openImport = async () => {
      await wallet!.gotoRoute('#/tokens/add?tab=custom');
      await page.locator('#custom-token-contract').fill(CONTRACT);
    };
    const expectStoredDetails = async (soft = false) => {
      const check = soft ? expect.soft : expect;
      await check(page.getByText(STORED_SYMBOL, { exact: true })).toHaveCount(
        1
      );
      await check(
        page.getByText('Owned', { exact: true }).locator('..')
      ).toContainText('2 NFTs');
    };
    const openStoredDetails = async () => {
      await wallet!.gotoRoute('#/home');
      await page.locator('#assets-btn').click();
      await page
        .getByRole('button', { name: en.tooltip.viewNFTs, exact: true })
        .click();
      await page
        .getByRole('button', {
          name: `View details for ${STORED_SYMBOL} collection`,
          exact: true,
        })
        .click();
      await expectStoredDetails();
    };
    await wallet.step(
      'save and reopen a genuine collection in account B',
      async () => {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await wallet!.gotoRoute('#/settings/account/new');
        await page
          .locator('#account-name-input')
          .fill('Stored collection account');
        await page.locator('#create-btn').click();
        await page
          .getByRole('button', { name: en.buttons.ok, exact: true })
          .click();
        await openImport();
        const importButton = page.getByRole('button', {
          name: `Import ${STORED_SYMBOL} token`,
          exact: true,
        });
        await importButton.click();
        await expect(
          page.getByText(
            en.tokens.hasBeenAddedToYourWallet.replace(
              '{{token}}',
              STORED_SYMBOL
            ),
            { exact: true }
          )
        ).toBeVisible();
        await expect(importButton).toBeDisabled();
        await openStoredDetails();
      }
    );
    // Menus are intentionally disabled away from Home. A second normal wallet
    // tab changes the account while the original details route stays mounted.
    const control = await wallet.context.newPage();
    await control.goto(wallet.appUrl('#/home'));
    await expect(control.locator('#initial-loader')).toHaveCSS('opacity', '0');
    await wallet.step(
      'open A preview then switch the other tab to stored B',
      async () => {
        await selectAccount(control, 0);
        phase = 'preview';
        await openImport();
        await page
          .getByRole('button', {
            name: `View details for ${STORED_SYMBOL} token`,
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/#\/home\/details$/);
        await expect(
          page.getByText('Owned', { exact: true }).locator('..')
        ).toHaveText(/Owned\s*1 NFT$/);
        await expect
          .poll(() =>
            page.evaluate(() => window.history.state?.usr?.isImportPreview)
          )
          .toBe(true);
        await expect(
          page.getByText(STORED_SYMBOL, { exact: true })
        ).toBeVisible();
        await selectAccount(control, 1);
        await expectStoredDetails();
      }
    );
    await wallet.step(
      'collection Back keeps B metadata and ownership',
      async () => {
        const collection = page.getByRole('button', {
          name: en.send.viewCollectionItems,
        });
        await expect(collection).toHaveCount(1);
        await collection.click();
        await expect(
          page.getByPlaceholder(en.send.enterTokenId, { exact: true })
        ).toBeVisible();
        await page
          .getByRole('button', { name: en.buttons.back, exact: true })
          .click();
        await expect(page).toHaveURL(/#\/home\/details$/);
        await expectStoredDetails(true);
        observations.push({
          stage: 'collection-back',
          hasStoredSymbol: await page
            .getByText(STORED_SYMBOL, { exact: true })
            .count(),
          isImportPreview: await page.evaluate(
            () => window.history.state?.usr?.isImportPreview
          ),
          owned: await page
            .getByText('Owned', { exact: true })
            .locator('..')
            .innerText(),
        });
      }
    );
    await wallet.step(
      'Close and a normal reopen retain the saved B collection',
      async () => {
        await page
          .getByRole('button', { name: en.buttons.close, exact: true })
          .first()
          .click();
        await expect(page).toHaveURL(/#\/home$/);
        await openStoredDetails();
        observations.push({ stage: 'saved-collection-reopened', stored: true });
      }
    );
    expect(deniedWrites).toEqual([]);
    expect(routes.deniedWrites).toEqual([]);
    await info.attach('preview-navigation-evidence', {
      body: JSON.stringify(
        {
          ...extensionEvidence(),
          observations,
          reads,
          deniedWrites,
          controllerStateReplaced: false,
          controllerResultsReplaced: false,
          syntheticHttpOnly: true,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    status = info.errors.length ? 'failed' : 'passed';
  } finally {
    await wallet?.dispose(status);
    await server.close();
    Object.assign(E2E_CONFIG, previous);
  }
});
