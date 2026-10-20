import { expect, test, type Locator } from '@playwright/test';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

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

async function typeDecimal(input: Locator, value: string) {
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  // A single fill() bypasses the intermediate empty, zero and decimal drafts.
  await input.pressSequentially(value, { delay: 20 });
}

test('fee keyboard input preserves exact wei, rejects lossy values and discards a later Cancel draft', async ({}, info) => {
  test.setTimeout(120_000);
  expect(process.env.PALI_TEST_DAPP_REVISION).toMatch(/^[a-f0-9]{40}$/);
  expect(path.isAbsolute(process.env.PALI_TEST_DAPP_EXTENSION_PATH || '')).toBe(
    true
  );
  expect(E2E_CONFIG.extensionPath).toBe(
    process.env.PALI_TEST_DAPP_EXTENSION_PATH
  );
  const previous = { ...E2E_CONFIG };
  // Port 0 atomically allocates an unused loopback port; no Anvil or unrelated
  // service on a fixed local port is contacted by this fixture.
  const server = await startUtxoFixtureServer();
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'FeeDecimalSyntheticOnly!2026',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  let routes:
    | Awaited<ReturnType<typeof installIsolatedVaultRoutes>>
    | undefined;
  let status: 'passed' | 'failed' = 'failed';
  const reads: string[] = [];
  const attemptedWrites: string[] = [];
  const observations: Record<string, unknown> = {
    syntheticHttpOnly: true,
    controllerStateReplaced: false,
    controllerResultsReplaced: false,
    transactionConfirmClicked: false,
  };
  try {
    wallet = await PaliWallet.launch('fee-decimal-input', {
      offlineHttpProxy: server.url,
      viewport: { width: 400, height: 620 },
    });
    observations.runtime = extensionEvidence();
    routes = await installIsolatedVaultRoutes(
      wallet.context,
      createIsolatedVaultFixture(),
      server.url
    );
    // HTTP read data only: the wallet constructs its ordinary unsigned send
    // and fee quote. The launch-time deny proxy never forwards public traffic.
    await wallet.context.route('https://rpc.tanenbaum.io/', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      const calls = Array.isArray(body) ? body : [body];
      if (
        calls.some((call: any) =>
          /^(?:eth_send|eth_sign|personal_|wallet_send|sys_sign|sendrawtransaction|anvil_|evm_)/i.test(
            call?.method || ''
          )
        )
      ) {
        attemptedWrites.push(...calls.map((call: any) => call.method));
        return route.abort('blockedbyclient');
      }
      const replies = calls.map((call: any) => {
        let result: unknown;
        if (call.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
        if (call.method === 'eth_estimateGas') result = '0x5208';
        if (call.method === 'eth_getTransactionCount') result = '0x0';
        if (call.method === 'eth_feeHistory')
          result = {
            oldestBlock: '0x1',
            baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
            gasUsedRatio: [0.5],
            reward: [['0x3b9aca00']],
          };
        return result === undefined
          ? undefined
          : { jsonrpc: '2.0', id: call.id, result };
      });
      if (!replies.every((reply) => reply !== undefined))
        return route.fallback();
      reads.push(...calls.map((call: any) => call.method));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
      });
    });
    const page = wallet.page;
    await wallet.step('open an unsigned EVM send review', async (capture) => {
      try {
        await wallet!.importSeedAndCreatePassword();
        await wallet!.switchNetwork('Syscoin NEVM Testnet', 'EVM');
        await wallet!.ensureOnHome();
        await expect(page.locator('#home-balance')).toHaveText('1');
        await page.locator('#send-btn').click();
        await page
          .getByPlaceholder('Receiver', { exact: true })
          .fill('0x1111111111111111111111111111111111111111');
        await page.getByPlaceholder('Amount', { exact: true }).fill('0.0005');
        await page.locator('#send-eth-next-btn').click();
        await expect(page).toHaveURL(/#\/send\/confirm$/);
        await expect(
          page.getByRole('button', { name: en.buttons.confirm, exact: true })
        ).toBeEnabled();
      } finally {
        if (!page.isClosed()) await capture(page);
      }
    });

    const edit = page.getByRole('button', {
      name: en.send.editFee,
      exact: true,
    });
    const dialog = page.getByRole('dialog');
    const maximum = dialog.getByLabel(`${en.send.maxFee} (GWEI)`, {
      exact: true,
    });
    const priority = dialog.getByLabel(`${en.send.maxPriority} (GWEI)`, {
      exact: true,
    });
    const gas = dialog.getByLabel(en.send.gasLimit, { exact: true });
    const read = async () => ({
      maximum: await maximum.inputValue(),
      priority: await priority.inputValue(),
      gas: await gas.inputValue(),
    });
    await wallet.step(
      'reject unrepresentable prices without changing the quote',
      async (capture) => {
        try {
          await edit.click();
          await expect(dialog).toBeVisible();
          const original = await read();
          await priority.fill('0');
          for (const value of [
            '1000000000000000000000',
            '0.0000000001',
            '9007199.254740991',
          ]) {
            await maximum.fill(value);
            await expect(
              dialog.getByRole('button', { name: en.buttons.save, exact: true })
            ).toBeDisabled();
            await expect(dialog).toBeVisible();
            observations[`rejected-${value}`] = await read();
          }
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
          await expect(dialog).toBeHidden();
          await expect(
            page.getByRole('button', { name: en.buttons.confirm, exact: true })
          ).toBeEnabled();
          await edit.click();
          await expect(dialog).toBeVisible();
          expect(await read()).toEqual(original);
          observations.afterInvalidCancel = await read();
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    await wallet.step(
      'save and reopen an exact one-wei cap with zero priority',
      async (capture) => {
        try {
          await edit.click();
          await expect(dialog).toBeVisible();
          await priority.fill('0');
          await typeDecimal(maximum, '0.000000001');
          await expect(maximum).toHaveValue('0.000000001');
          await dialog
            .getByRole('button', { name: en.buttons.save, exact: true })
            .click();
          await expect(dialog).toBeHidden();
          await edit.click();
          await expect(dialog).toBeVisible();
          await expect(maximum).toHaveValue('0.000000001');
          await expect(priority).toHaveValue('0');
          observations.savedOneWei = await read();
          await dialog
            .getByRole('button', { name: en.buttons.cancel, exact: true })
            .click();
        } finally {
          if (!page.isClosed()) await capture(page);
        }
      }
    );
    for (const viewport of [
      { width: 320, height: 360 },
      { width: 400, height: 620 },
    ]) {
      await wallet.step(
        `type and save exactly 0.5 GWEI at ${viewport.width}px`,
        async (capture) => {
          try {
            await page.setViewportSize(viewport);
            await edit.click();
            await expect(dialog).toBeVisible();
            // Zero is a supported priority fee and isolates the decimal-input
            // check from the independent maximum >= priority validation rule.
            await priority.fill('0');
            await typeDecimal(maximum, '0.5');
            observations[`typed-${viewport.width}`] = await read();
            await expect(maximum).toHaveValue('0.5');
            await dialog
              .getByRole('button', { name: en.buttons.save, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            await edit.click();
            await expect(dialog).toBeVisible();
            const reopened = await read();
            observations[`saved-${viewport.width}`] = reopened;
            expect(reopened.maximum).toBe('0.5');
            expect(reopened.priority).toBe('0');
            expect(Number(reopened.gas)).toBeGreaterThanOrEqual(21000);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `discard a later decimal draft without changing the saved fee at ${viewport.width}px`,
        async (capture) => {
          try {
            const saved = await read();
            await typeDecimal(maximum, '0.75');
            await expect(maximum).toHaveValue('0.75');
            await dialog
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            await edit.click();
            await expect(dialog).toBeVisible();
            observations[`after-cancel-${viewport.width}`] = await read();
            expect(await read()).toEqual(saved);
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
      await wallet.step(
        `leave the fee review unsigned at ${viewport.width}px`,
        async (capture) => {
          try {
            await dialog
              .getByRole('button', { name: en.buttons.cancel, exact: true })
              .click();
            await expect(dialog).toBeHidden();
            await expect(page).toHaveURL(/#\/send\/confirm$/);
            await expect(
              page.getByRole('button', {
                name: en.buttons.confirm,
                exact: true,
              })
            ).toBeVisible();
          } finally {
            if (!page.isClosed()) await capture(page);
          }
        }
      );
    }
    expect(reads).toContain('eth_estimateGas');
    expect(routes.deniedWrites).toEqual([]);
    expect(attemptedWrites).toEqual([]);
    status = 'passed';
  } finally {
    try {
      const evidence = info.outputPath('fee-decimal-input-evidence.json');
      fs.writeFileSync(
        evidence,
        JSON.stringify(
          {
            ...observations,
            testSourceSha256: createHash('sha256')
              .update(fs.readFileSync(__filename))
              .digest('hex'),
            reads,
            deniedWrites: [...attemptedWrites, ...(routes?.deniedWrites || [])],
            proxyDeniedConnections: server.blocked.length,
          },
          null,
          2
        )
      );
      await info.attach('fee-decimal-input-evidence', {
        path: evidence,
        contentType: 'application/json',
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
