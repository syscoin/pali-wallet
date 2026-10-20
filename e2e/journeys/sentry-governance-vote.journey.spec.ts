import { expect, test } from '@playwright/test';
import { utils } from 'syscoinjs-lib';

import { E2E_CONFIG } from '../harness/config';
import { dismissRejectedApproval } from '../harness/dismissRejectedApproval';
import { PaliWallet } from '../harness/pali';
import {
  approve,
  popupFor,
  providerRequest,
  settle,
  startRequest,
} from '../harness/testDappConformance';
import {
  createUtxoFixture,
  fixtureRead,
  installUtxoFixtureRoutes,
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

test('Pali reviews and signs exact legacy governance votes without disclosing keys', async ({}, info) => {
  const sdk = await import('@sidhujag/sysweb3-sentry');
  const before = { ...E2E_CONFIG };
  const secret = '00'.repeat(31) + '0d';
  const key = await sdk.importSentryAuthorityKey('voting', 'secp256k1', secret);
  const identities = await sdk.governanceVotingKeyIds(key.publicKey);
  const chain = {
    genesisHash:
      '0000066e1a6b9cfeac8295dce0cc8d9170690a74bc4878cf8a0b412554f5c222',
    era: 'legacy-v3' as const,
  };
  const nodes = [
    {
      proTxHash: '51'.repeat(32),
      collateralOutpoint: { txid: '61'.repeat(32), vout: 1 },
    },
    {
      proTxHash: '52'.repeat(32),
      collateralOutpoint: { txid: '62'.repeat(32), vout: 2 },
    },
  ];
  const request = {
    version: 1 as const,
    chain,
    proposalHash: '73'.repeat(32),
    signal: 'funding' as const,
    outcome: 'no' as const,
    timestamp: Math.floor(Date.now() / 1000),
    nodes,
  };
  const observation = {
    chain,
    now: request.timestamp,
    proposalHash: request.proposalHash,
    proposal: {
      name: 'Independent funding proposal',
      url: 'https://proposal.example/details',
    },
    nodes: nodes.map((node, index) => ({
      ...node,
      votingKeyId: index ? identities.uncompressed : identities.compressed,
      valid: true as const,
    })),
  };
  const fixture = createUtxoFixture();
  let walletAddress: string | undefined;
  const server = await startUtxoFixtureServer({
    readJson: (url) => {
      if (url.pathname === '/api/sentry/v1/voting-context') return observation;
      if (walletAddress && url.pathname === `/api/v2/address/${walletAddress}`)
        return {
          address: walletAddress,
          balance: '0',
          unconfirmedBalance: '0',
          txs: 0,
          tokens: [],
          transactions: [],
        };
      return fixtureRead(
        fixture,
        'https://blockbook-dev.syscoin.org' + url.pathname + url.search,
        'GET'
      );
    },
  });
  let nextSite: Awaited<ReturnType<typeof startUtxoFixtureServer>> | undefined;
  Object.assign(E2E_CONFIG, {
    seedPhrase: UTXO_FIXTURE_SEED,
    password: 'GovernanceSyntheticOnly!2026',
    chainId: 5700,
    networkLabel: 'Syscoin Testnet',
    rpcUrl: server.url,
  });
  let wallet: PaliWallet | undefined;
  try {
    wallet = await PaliWallet.launch('sentry-governance-voting', {
      offlineHttpProxy: server.url,
    });
    const page = wallet.page;
    const pair = utils.bitcoinjs.ECPair.fromPrivateKey(
      Buffer.from(secret, 'hex'),
      { network: utils.syscoinNetworks.testnet, compressed: false }
    );
    const routes = await wallet.step(
      'set up the wallet, import a voting key, and connect the dapp',
      async () => {
        const fixtureRoutes = await installUtxoFixtureRoutes(
          wallet.context,
          fixture,
          server.url
        );
        await wallet.context.route(`${server.url}/**`, (route) =>
          route.continue()
        );
        await wallet.importSeedAndCreatePassword();
        await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
        await wallet.ensureOnHome();
        await wallet.gotoRoute('#/settings/sentry');
        await page
          .getByRole('button', { name: 'Import Sentry key', exact: true })
          .click();
        await page
          .getByLabel('Key role', { exact: true })
          .selectOption('voting');
        await page
          .getByLabel('Key label', { exact: true })
          .fill('Private governance key');
        await page
          .getByLabel('Sentry private key (hex or WIF)', { exact: true })
          .fill(pair.toWIF());
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await page.getByRole('checkbox').check();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByRole('heading', {
            name: 'Private governance key',
            exact: true,
          })
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Trusted data service', exact: true })
          .click();
        await page
          .getByLabel('Trusted HTTPS service origin', { exact: true })
          .fill(server.url);
        await page
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(
          page.getByText('Trusted service settings saved.', { exact: true })
        ).toBeVisible();
        await page.goto(server.url);
        await page.waitForFunction(() => Boolean((window as any).pali));
        const connected = await approve(
          wallet.context,
          page,
          await startRequest(page, 'sys_requestAccounts')
        );
        expect(connected.result).toEqual([fixture.userAddress]);
        expect(
          (await providerRequest(page, 'sys_getSentryCapabilities'))
            .governanceVote
        ).toEqual({ scheme: 'secp256k1', signal: 'funding', maxNodes: 20 });
        return fixtureRoutes;
      }
    );
    await wallet.step(
      'reject another network and cancel without signing',
      async (capture) => {
        const wrongNetwork = await settle(
          page,
          await startRequest(page, 'sys_signSentryVote', [
            { ...request, chain: { ...chain, genesisHash: 'ff'.repeat(32) } },
          ])
        );
        expect(wrongNetwork.error).toBeTruthy();

        const cancelledId = await startRequest(page, 'sys_signSentryVote', [
          request,
        ]);
        const cancelledPopup = await popupFor(
          wallet.context,
          page,
          cancelledId
        );
        await expect(
          cancelledPopup.getByText('Independent funding proposal', {
            exact: true,
          })
        ).toBeVisible();
        await expect(
          cancelledPopup.getByText('No · Funding vote', { exact: true })
        ).toBeVisible();
        await capture(cancelledPopup);
        const cancelledResult = await dismissRejectedApproval({
          click: () =>
            cancelledPopup
              .getByRole('button', { name: 'Cancel', exact: true })
              .click(),
          isClosed: () => cancelledPopup.isClosed(),
          settle: () => settle(page, cancelledId),
        });
        expect(cancelledResult.error).toBeTruthy();
      }
    );

    await wallet.step(
      'review and sign both voting-key encodings in a small window',
      async (capture) => {
        const id = await startRequest(page, 'sys_signSentryVote', [request]);
        const popup = await popupFor(wallet.context, page, id);
        await popup.setViewportSize({ width: 320, height: 360 });
        await popup
          .locator('form')
          .getByRole('heading', {
            name: 'Independent funding proposal',
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await expect(
          popup.getByText('No · Funding vote', { exact: true })
        ).toBeInViewport({ ratio: 1 });
        await popup.screenshot({
          path: info.outputPath('governance-top-320x360.png'),
        });
        await popup
          .getByText('Review nodes and vote details', { exact: true })
          .click();
        await expect(
          popup.getByText(request.proposalHash, { exact: true })
        ).toBeVisible();
        expect(
          await popup.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        await popup
          .getByText('Review nodes and vote details', { exact: true })
          .click();
        await popup
          .getByLabel('Wallet password', { exact: true })
          .scrollIntoViewIfNeeded();
        await popup.screenshot({
          path: info.outputPath('governance-320x360.png'),
        });
        await capture(popup);
        await popup
          .getByLabel('Wallet password', { exact: true })
          .fill(E2E_CONFIG.password);
        await popup
          .getByRole('button', { name: 'Sign votes', exact: true })
          .click();
        const signed = await settle(page, id, 45000);
        expect(signed.error).toBeUndefined();
        expect(signed.result.votes).toHaveLength(2);
        for (const vote of signed.result.votes)
          expect(
            await sdk.verifySentryGovernanceVote(request, observation, vote)
          ).toBe(true);
        expect(
          Buffer.from(signed.result.votes[0].voteSig, 'base64')[0]
        ).toBeGreaterThanOrEqual(31);
        expect(
          Buffer.from(signed.result.votes[1].voteSig, 'base64')[0]
        ).toBeLessThan(31);
        expect(JSON.stringify(signed.result)).not.toContain(secret);
        expect(JSON.stringify(signed.result)).not.toContain(pair.toWIF());
      }
    );
    await wallet.step(
      'keep missing voting-key details inside the wallet',
      async (capture) => {
        observation.nodes[0].votingKeyId = 'ab'.repeat(20);
        const missingId = await startRequest(page, 'sys_signSentryVote', [
          request,
        ]);
        const missingPopup = await popupFor(wallet.context, page, missingId);
        await expect(missingPopup.getByRole('alert')).toContainText(
          'Some nodes need their voting keys'
        );
        await expect(
          missingPopup.getByRole('button', { name: 'Sign votes', exact: true })
        ).toBeDisabled();
        await expect(
          missingPopup.getByLabel('Wallet password', { exact: true })
        ).toHaveCount(0);
        await capture(missingPopup);
        const missingResult = await dismissRejectedApproval({
          click: () =>
            missingPopup
              .getByRole('button', { name: 'Cancel', exact: true })
              .click(),
          isClosed: () => missingPopup.isClosed(),
          settle: () => settle(page, missingId),
        });
        expect(missingResult.error).toBeTruthy();
        expect(JSON.stringify(missingResult)).not.toContain(
          'missingVotingKeys'
        );
      }
    );

    await wallet.step(
      'approve a new origin and sign with the selected wallet fallback',
      async (capture) => {
        // Also exercise the selected-wallet fallback without a dedicated Sentry
        // import: legacy Core voting may register the uncompressed WIF identity.
        const walletPair = utils.bitcoinjs.ECPair.fromPrivateKey(
          Buffer.from('00'.repeat(31) + '0e', 'hex'),
          { network: utils.syscoinNetworks.testnet, compressed: false }
        );
        walletAddress = utils.bitcoinjs.payments.p2pkh({
          pubkey: walletPair.publicKey,
          network: utils.syscoinNetworks.testnet,
        }).address;
        const walletIdentities = await sdk.governanceVotingKeyIds(
          Buffer.from(
            utils.bitcoinjs.ECPair.fromPrivateKey(walletPair.privateKey, {
              compressed: true,
            }).publicKey
          ).toString('hex')
        );
        observation.nodes.forEach((node) => {
          node.votingKeyId = walletIdentities.uncompressed;
        });
        await wallet.gotoRoute('#/settings/account/import');
        await page
          .locator('#import-account-identifier')
          .fill(walletPair.toWIF());
        await page.getByRole('radio', { name: 'Legacy (P2PKH)' }).check();
        await page.getByRole('button', { name: 'Import', exact: true }).click();
        await expect(
          page.getByText('Account imported successfully')
        ).toBeVisible();
        // Keep the imported account's background reads on the same deny-proxy
        // fixture as the original account; never reach a public Blockbook service.
        await page.evaluate(async (url) => {
          const call = (method: string, params: unknown[]) =>
            new Promise<any>((resolve) =>
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['wallet', method], params },
                },
                resolve
              )
            );
          const state = await call('getState', []);
          await call('setActiveNetwork', [
            { ...state.vault.activeNetwork, url },
            true,
          ]);
        }, server.url);
        await page.goto(server.url);
        await page.waitForFunction(() => Boolean((window as any).pali));
        // Importing another account must not silently grant it to an already
        // connected site. Request its consent on a fresh isolated dapp origin.
        expect(await providerRequest(page, 'sys_requestAccounts')).toEqual([
          fixture.userAddress,
        ]);
        nextSite = await startUtxoFixtureServer();
        // The launch-time proxy intentionally does not forward even loopback
        // origins. Serve only the same known read-only fixture document here.
        const dappHtml = await (await fetch(server.url)).text();
        await wallet.context.route(`${nextSite.url}/`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: dappHtml,
          })
        );
        await page.goto(nextSite.url);
        await page.waitForFunction(() => Boolean((window as any).pali));
        expect(
          (
            await approve(
              wallet.context,
              page,
              await startRequest(page, 'sys_requestAccounts')
            )
          ).result
        ).toEqual([walletAddress]);
        const walletId = await startRequest(page, 'sys_signSentryVote', [
          request,
        ]);
        const walletPopup = await popupFor(wallet.context, page, walletId);
        await expect(
          walletPopup.getByRole('button', { name: 'Sign votes' })
        ).toBeDisabled();
        await capture(walletPopup);
        await walletPopup
          .getByLabel('Wallet password')
          .fill(E2E_CONFIG.password);
        await expect(
          walletPopup.getByRole('button', { name: 'Sign votes' })
        ).toBeEnabled();
        await walletPopup.getByRole('button', { name: 'Sign votes' }).click();
        const walletSigned = await settle(page, walletId, 45000);
        expect(walletSigned.error).toBeUndefined();
        expect(walletSigned.result.votes).toHaveLength(2);
        for (const vote of walletSigned.result.votes) {
          expect(
            await sdk.verifySentryGovernanceVote(request, observation, vote)
          ).toBe(true);
          expect(Buffer.from(vote.voteSig, 'base64')[0]).toBeLessThan(31);
        }
        expect(JSON.stringify(walletSigned.result)).not.toContain(
          walletPair.toWIF()
        );
      }
    );
    await wallet.step(
      'verify the governance fixture never broadcasts',
      async () => {
        expect(routes.deniedWrites).toEqual([]);
        expect(routes.syntheticBroadcasts).toEqual([]);
      }
    );
    await wallet.dispose('passed');
    wallet = undefined;
  } catch (error) {
    await wallet?.dispose('failed');
    wallet = undefined;
    throw error;
  } finally {
    await wallet?.dispose('failed');
    Object.assign(E2E_CONFIG, before);
    await nextSite?.close();
    await server.close();
  }
});
