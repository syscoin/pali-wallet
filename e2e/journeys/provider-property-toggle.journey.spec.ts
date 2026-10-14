import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { E2E_CONFIG } from '../harness/config';
import { startDappServer } from '../harness/dappServer';
import {
  LOCAL_CHAINS,
  approve,
  extensionEvidence,
  installConformanceInstrumentation,
  launchConformanceWallet,
  providerRequest,
  startLocalChains,
  startRequest,
} from '../harness/testDappConformance';

test('settings: disable and re-enable Ethereum without reloading or reconnecting dapps', async () => {
  const stopChains = await startLocalChains();
  const wallet = await launchConformanceWallet().catch((error) => {
    stopChains();
    throw error;
  });
  const server = await startDappServer();
  try {
    const { forbiddenBroadcasts } = await installConformanceInstrumentation(
      wallet.context
    );
    await wallet.context.route('**/*', async (route) => {
      let payload: any;
      try {
        payload = route.request().postDataJSON();
      } catch {
        /* Not JSON RPC. */
      }
      const requests = Array.isArray(payload) ? payload : [payload];
      const isRpc = requests.some(
        (request) => typeof request?.method === 'string'
      );
      const isLocal = LOCAL_CHAINS.some(
        (chain) => new URL(route.request().url()).origin === chain.url
      );
      if (isRpc && !isLocal) {
        for (const request of requests) {
          if (
            /^(eth_sendRawTransaction|eth_sendTransaction|wallet_sendCalls)$/.test(
              request?.method
            )
          )
            forbiddenBroadcasts.push({
              url: route.request().url(),
              method: request.method,
            });
        }
        await route.abort('blockedbyclient');
      } else await route.fallback();
    });
    await wallet.step('import isolated local fixture', async () => {
      await wallet.importSeedAndCreatePassword();
      await wallet.ensureOnHome();
      await wallet.page.goto('about:blank');
    });
    const page = await wallet.context.newPage();
    await page.goto(server.url);
    await page.waitForFunction(() => Boolean(window.ethereum));
    await approve(
      wallet.context,
      page,
      await startRequest(page, 'wallet_addEthereumChain', [
        {
          chainId: LOCAL_CHAINS[0].hexId,
          chainName: 'Pali local provider toggle',
          nativeCurrency: { name: 'Local Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [LOCAL_CHAINS[0].url],
        },
      ])
    );
    const connected = await approve(
      wallet.context,
      page,
      await startRequest(page, 'eth_requestAccounts')
    );
    expect(connected.result).toHaveLength(1);
    await page.evaluate(() => {
      (window as any).__toggleInitialProvider = window.ethereum;
      (window as any).__toggleInitialUuid = (window as any).paliProvider.uuid;
    });

    await wallet.step(
      'normal settings disable removes fallback and disconnects accounts',
      async () => {
        await wallet.gotoRoute('#/settings/remove-eth');
        await wallet.page
          .getByRole('button', { name: 'Set Metamask as default wallet' })
          .click();
        await expect
          .poll(() => page.evaluate(() => Boolean(window.ethereum)))
          .toBe(false);
        await expect
          .poll(() => providerRequest(page, 'eth_accounts'))
          .toEqual([]);
        expect(await providerRequest(page, 'wallet_getPermissions')).toEqual(
          []
        );
        await wallet.page.getByRole('button', { name: /^ok$/i }).click();
      }
    );

    // This tab has never requested account permission and was opened while
    // Ethereum injection was disabled. Enabling must reach its live receiver.
    const unconnected = await wallet.context.newPage();
    await unconnected.goto(`${server.url}unconnected`);
    await unconnected.waitForFunction(() => Boolean((window as any).pali));
    expect(await unconnected.evaluate(() => Boolean(window.ethereum))).toBe(
      false
    );
    const unsupported = await wallet.context.newPage();
    await unsupported.goto(`${server.url}unsupported.pdf`);
    expect(await unsupported.evaluate(() => Boolean(window.ethereum))).toBe(
      false
    );

    await wallet.step(
      'normal settings re-enable restores provider but not account permission',
      async () => {
        // Reopen only the settings UI; the connected dapp is never reloaded.
        await wallet.gotoRoute('#/settings/remove-eth');
        await wallet.page
          .getByRole('button', { name: 'Set Pali as default wallet' })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              () => window.ethereum === (window as any).__toggleInitialProvider
            )
          )
          .toBe(true);
        expect(
          await page.evaluate(
            () =>
              (window as any).paliProvider.uuid ===
              (window as any).__toggleInitialUuid
          )
        ).toBe(true);
        expect(await providerRequest(page, 'eth_accounts')).toEqual([]);
        expect(await providerRequest(page, 'wallet_getPermissions')).toEqual(
          []
        );
        expect(await providerRequest(page, 'eth_chainId')).toBe(
          LOCAL_CHAINS[0].hexId
        );
        await unconnected.waitForFunction(() => Boolean(window.ethereum));
        expect(await providerRequest(unconnected, 'eth_accounts')).toEqual([]);
        expect(await unsupported.evaluate(() => Boolean(window.ethereum))).toBe(
          false
        );
      }
    );

    expect(forbiddenBroadcasts).toEqual([]);
    fs.writeFileSync(
      path.join(E2E_CONFIG.artifactsDir, 'provider-property-toggle.json'),
      JSON.stringify(
        {
          ...extensionEvidence(),
          status: 'passed',
          restoredSameProvider: true,
          restoredSameUuid: true,
          accountPermissionsAfterEnable: [],
          unconnectedTabReceivedProvider: true,
          unsupportedTabStayedUninjected: true,
          forbiddenBroadcasts,
        },
        null,
        2
      )
    );
    await wallet.dispose('passed');
  } catch (error) {
    await wallet.dispose('failed');
    throw error;
  } finally {
    await server.close();
    stopChains();
  }
});
