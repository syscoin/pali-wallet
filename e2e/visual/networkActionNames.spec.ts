import { expect, test } from '@playwright/test';

import en from '../../source/assets/locales/en.json';
import { E2E_CONFIG } from '../harness/config';
import { PaliWallet } from '../harness/pali';
import {
  createUtxoFixture,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('network-management icon actions expose their purpose and full network identity', async () => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'NetworkNamesSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  try {
    wallet = await PaliWallet.launch('network-action-names', {
      offlineHttpProxy: server.url,
      viewport: { width: 320, height: 360 },
    });
    const routes = await installUtxoFixtureRoutes(
      wallet.context,
      createUtxoFixture(),
      server.url
    );
    await wallet.importSeedAndCreatePassword();
    await wallet.ensureOnHome();
    const page = wallet.page;
    await wallet.step(
      'identify every edit and removal action without relying on icon names',
      async () => {
        await wallet!.gotoRoute('#/settings/networks/edit');
        const networks = await page.evaluate(async () => {
          const state = await chrome.runtime.sendMessage({
            type: 'getCurrentState',
          });
          return Object.values(state.vaultGlobal.networks).flatMap(
            (family: any) =>
              Object.values(family).map((network: any) => ({
                label: network.label,
                default: network.default,
                chainId: network.chainId,
                kind: network.kind,
              }))
          );
        });
        expect(networks.length).toBeGreaterThan(1);
        const identity = (network: (typeof networks)[number]) =>
          `${network.label} (${
            network.kind === 'syscoin' ? 'UTXO' : 'EVM'
          } · ${en.settings.chainNumber.replace(
            '{{chainId}}',
            String(network.chainId)
          )})`;
        for (const network of networks) {
          expect(
            await page
              .getByRole('button', {
                name: `${en.buttons.edit}: ${identity(network)}`,
                exact: true,
              })
              .count()
          ).toBeGreaterThan(0);
          if (!network.default)
            expect(
              await page
                .getByRole('button', {
                  name: `${en.buttons.remove}: ${identity(network)}`,
                  exact: true,
                })
                .count()
            ).toBeGreaterThan(0);
        }
        const first = page.getByRole('button', {
          name: `${en.buttons.edit}: ${identity(networks[0])}`,
          exact: true,
        });
        await first.scrollIntoViewIfNeeded();
        await first.click();
        await expect(page).toHaveURL(/#\/settings\/networks\/custom-rpc$/);
        // A URL change can precede the editor render; wait for the new screen.
        await expect(page.locator('form#rpc')).toBeVisible();
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await expect(page).toHaveURL(/#\/settings\/networks\/edit$/);
      }
    );
    expect(routes.deniedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      await wallet?.dispose(status);
    } finally {
      await server.close();
      Object.assign(E2E_CONFIG, previous);
    }
  }
});
