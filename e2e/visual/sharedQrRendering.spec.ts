import { expect, test } from '@playwright/test';
import { createHash } from 'crypto';

import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Receive and Edit Account render the same public-address QR across network families', async ({}, info) => {
  const previous = { ...E2E_CONFIG };
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'SharedQrSynthetic!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const rendered: { address: string; svg: string }[] = [];
  try {
    wallet = await PaliWallet.launch('shared-qr-rendering', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    const routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    await wallet.step('import disposable synthetic wallet', async () => {
      await wallet!.importSeedAndCreatePassword();
    });
    for (const [label, group] of [
      ['Syscoin Testnet', 'UTXO'],
      ['Syscoin NEVM Testnet', 'EVM'],
    ] as const) {
      await wallet.step(`compare both QR consumers on ${label}`, async () => {
        await wallet!.switchNetwork(label, group);
        await wallet!.gotoRoute('#/receive');
        const receive = wallet!.page.locator('#qr-code svg');
        await expect(receive).toBeVisible();
        const address = wallet!.page.locator('#qr-code + div p');
        await expect(address).not.toHaveText('');
        const publicAddress = await address.innerText();
        const receiveSvg = await receive.evaluate((svg) => svg.outerHTML);
        expect(await receive.locator('path').count()).toBeGreaterThan(0);

        await wallet!.gotoRoute('#/settings/manage-accounts');
        await wallet!.page
          .locator('[data-navigation-scroll="settings-manage-accounts"] li')
          .first()
          .getByRole('button')
          .first()
          .click();
        await expect(wallet!.page).toHaveURL(/settings\/edit-account/);
        const edit = wallet!.page.locator('#edit-account > svg');
        await expect(edit).toBeVisible();
        await expect(
          wallet!.page.locator('#edit-account p[title]')
        ).toHaveAttribute('title', publicAddress);
        expect(await edit.evaluate((svg) => svg.outerHTML)).toBe(receiveSvg);
        rendered.push({ address: publicAddress, svg: receiveSvg });
      });
    }
    expect(rendered).toHaveLength(2);
    expect(rendered[0].address).not.toBe(rendered[1].address);
    expect(rendered[0].svg).not.toBe(rendered[1].svg);
    expect(routes.deniedWrites).toEqual([]);
    expect(routes.syntheticBroadcasts).toEqual([]);
    await info.attach('public-address-qr-equality', {
      contentType: 'application/json',
      body: JSON.stringify(
        rendered.map(({ address, svg }) => ({
          address,
          svgSha256: createHash('sha256').update(svg).digest('hex'),
          consumersEqual: true,
        }))
      ),
    });
    status = 'passed';
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
});
