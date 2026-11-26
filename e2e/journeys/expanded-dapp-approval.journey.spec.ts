import { expect, test } from '@playwright/test';
import { Interface } from 'ethers';

import en from '../../source/assets/locales/en.json';
import officialDeploymentContracts from '../../tests/fixtures/officialDeploymentContracts.json';
import { clickClosingPopup } from '../harness/dismissRejectedApproval';
import {
  LOCAL_CHAINS,
  approve,
  installConformanceInstrumentation,
  launchConformanceWallet,
  localRpc,
  openOfficialDapp,
  popupFor,
  settle,
  startLocalChains,
  startRequest,
} from '../harness/testDappConformance';

test('external approval follows a real Chrome popup resize', async () => {
  test.setTimeout(180_000);
  const chain = LOCAL_CHAINS[0];
  const stopChains = await startLocalChains([chain]);
  try {
    const wallet = await launchConformanceWallet('expanded-dapp-approval', {
      viewport: null,
    });
    let passed = false;
    try {
      const { forbiddenBroadcasts } = await installConformanceInstrumentation(
        wallet.context
      );
      await wallet.importSeedAndCreatePassword();
      await wallet.ensureOnHome();
      for (const tab of wallet.context.pages()) {
        if (tab.url().includes('/app.html')) await tab.goto('about:blank');
      }
      const dapp = await openOfficialDapp(wallet.context);
      await approve(
        wallet.context,
        dapp,
        await startRequest(dapp, 'wallet_addEthereumChain', [
          {
            chainId: chain.hexId,
            chainName: `Pali Local ${chain.chainId}`,
            nativeCurrency: {
              name: 'Local Ether',
              symbol: 'ETH',
              decimals: 18,
            },
            rpcUrls: [chain.url],
          },
        ])
      );
      const connection = await approve(
        wallet.context,
        dapp,
        await startRequest(dapp, 'eth_requestAccounts')
      );
      const account = connection.result[0];
      const localToken = officialDeploymentContracts.contracts.erc20;
      const tokenAbi = new Interface(localToken.abi);
      const deploymentHash = await localRpc(chain.url, 'eth_sendTransaction', [
        {
          from: account,
          data:
            localToken.bytecode +
            tokenAbi.encodeDeploy([10, 'TST', 4, 'TST']).slice(2),
        },
      ]);
      await expect
        .poll(
          async () =>
            (
              await localRpc(chain.url, 'eth_getTransactionReceipt', [
                deploymentHash,
              ])
            )?.contractAddress
        )
        .toMatch(/^0x[0-9a-f]{40}$/i);
      const receipt = await localRpc(chain.url, 'eth_getTransactionReceipt', [
        deploymentHash,
      ]);
      const spender = '0x' + 'ab'.repeat(20);
      const approvalAbi = new Interface([
        'function approve(address spender, uint256 amount)',
      ]);
      const request = await startRequest(dapp, 'eth_sendTransaction', [
        {
          from: account,
          to: receipt.contractAddress,
          data: approvalAbi.encodeFunctionData('approve', [spender, 10]),
        },
      ]);
      const popup = await popupFor(wallet.context, dapp, request);
      const cancel = popup.getByRole('button', {
        name: en.buttons.cancel,
        exact: true,
      });
      const confirm = popup.getByRole('button', {
        name: en.buttons.confirm,
        exact: true,
      });
      const layout = popup.locator('[data-navigation-scroll="wallet-layout"]');
      await expect(confirm).toBeEnabled();
      const geometry = () =>
        layout.evaluate(async (panel) => {
          const footer = Array.from(
            panel.querySelectorAll<HTMLElement>('.fixed')
          ).find((element) => element.classList.contains('bottom-0'))!;
          const { id, width, height, type } = await chrome.windows.getCurrent();
          const { x, y, right, bottom } = panel.getBoundingClientRect();
          const action = footer.getBoundingClientRect();
          return {
            id: id!,
            type,
            outer: { width, height },
            inner: { width: innerWidth, height: innerHeight },
            panel: { x, y, right, bottom },
            footer: {
              x: action.x,
              right: action.right,
              top: action.top,
              bottom: action.bottom,
            },
          };
        });
      const defaultWindow = await geometry();
      expect(defaultWindow.type).toBe('popup');
      expect(defaultWindow.outer).toEqual({ width: 400, height: 620 });
      const checkLayout = async () => {
        const { panel, footer, inner } = await geometry();
        expect(panel.right - panel.x).toBe(Math.min(inner.width, 620));
        expect(panel.bottom - panel.y).toBe(Math.min(inner.height, 800));
        expect(footer.x).toBeCloseTo(panel.x, 0);
        expect(footer.right).toBeCloseTo(panel.right, 0);
        expect(footer.bottom).toBeCloseTo(panel.bottom, 0);
        await expect(cancel).toBeInViewport();
        await expect(confirm).toBeInViewport();
      };
      const resize = async (size: { height: number; width: number }) => {
        await popup.evaluate(
          ({ id, bounds }) => chrome.windows.update(id, bounds),
          { id: defaultWindow.id, bounds: size }
        );
        await expect.poll(async () => (await geometry()).outer).toEqual(size);
      };
      await wallet.step('standard Chrome approval window', async (capture) => {
        await capture(popup);
        await checkLayout();
      });
      await wallet.step('enlarged Chrome approval window', async (capture) => {
        await resize({ width: 1000, height: 900 });
        await capture(popup);
        await checkLayout();
      });
      await wallet.step(
        'short approval scrolls without covering actions',
        async (capture) => {
          await resize({ width: 360, height: 390 });
          const { footer, inner } = await geometry();
          await popup.mouse.move(inner.width / 2, footer.top - 20);
          await popup.mouse.wheel(0, 800);
          const lastDetail = popup.getByText(
            `${en.send.total} (${en.send.amountAndFee})`,
            { exact: false }
          );
          await expect
            .poll(async () => {
              const bounds = await lastDetail.boundingBox();
              return Boolean(
                bounds && bounds.y >= 0 && bounds.y + bounds.height < footer.top
              );
            })
            .toBe(true);
          await capture(popup);
          await checkLayout();
        }
      );
      await clickClosingPopup({
        click: () => cancel.click(),
        isClosed: () => popup.isClosed(),
      });
      expect((await settle(dapp, request)).error?.code).toBe(4001);
      expect(forbiddenBroadcasts).toEqual([]);
      passed = true;
    } finally {
      await wallet.dispose(passed ? 'passed' : 'failed');
    }
  } finally {
    stopChains();
  }
});
