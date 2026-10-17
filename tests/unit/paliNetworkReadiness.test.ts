import { expect as playwrightExpect } from '@playwright/test';

import { PaliWallet } from '../../e2e/harness/pali';
import en from '../../source/assets/locales/en.json';

jest.mock('@playwright/test', () => {
  const assertion = Object.assign(
    jest.fn(() => ({
      toHaveAttribute: jest.fn().mockResolvedValue(undefined),
    })),
    { poll: jest.fn() }
  );
  return { expect: assertion };
});

describe('Pali network switch informational dialog readiness', () => {
  const target = 'Syscoin NEVM Testnet';
  const setup = (
    prompt: 'none' | 'faucet' | 'late' | 'approval' | 'incomplete',
    targetLabel = target,
    iconText = '',
    selectedLabel = targetLabel
  ) => {
    const title = en.faucet.firstAccessTitle
      .replace('{{token}}', 'TSYS')
      .replace('{{network}}', targetLabel);
    let selected = false;
    let dismissed = false;
    let observations = 0;
    let balanceVisible = true;
    let contextBusy = false;
    let postLoading = false;
    let delayedFaucet = false;
    let onPoll: (attempt: number) => void = () => undefined;
    const visiblePrompt = () =>
      selected && !dismissed && (prompt !== 'none' || delayedFaucet);
    const close = {
      click: jest.fn(async () => {
        dismissed = true;
      }),
    };
    const goToFaucet = {
      isVisible: jest.fn(async () => prompt !== 'incomplete'),
      click: jest.fn(),
    };
    const dialog = {
      isVisible: jest.fn(async () => {
        observations++;
        return (
          visiblePrompt() &&
          prompt !== 'approval' &&
          (prompt !== 'late' || observations > 1)
        );
      }),
      getByRole: jest.fn((_role, options) => {
        if (options.name === en.buttons.close) return close;
        if (options.name === en.faucet.grabTokens) return goToFaucet;
        throw new Error('Unexpected dialog action');
      }),
    };
    const label: any = {
      innerText: jest.fn(async () =>
        selected ? selectedLabel : 'Syscoin Testnet'
      ),
    };
    label.first = () => label;
    const header = {
      click: jest.fn(),
      isVisible: jest.fn(async () => !visiblePrompt()),
      innerText: jest.fn(
        async () =>
          `${iconText}${iconText ? '\n' : ''}${
            selected ? selectedLabel + ' EVM' : 'Syscoin Testnet UTXO'
          }`
      ),
      locator: jest.fn((selector) => {
        expect(selector).toBe(':scope > span');
        return label;
      }),
    };
    const group: any = { getAttribute: jest.fn(async () => 'true') };
    group.first = () => group;
    const option: any = {
      click: jest.fn(async () => {
        selected = true;
      }),
    };
    option.first = () => option;
    const balance = {
      isVisible: jest.fn(async () => balanceVisible),
      evaluate: jest.fn(async () => !contextBusy),
      waitFor: jest.fn(async () => {
        if (!balanceVisible) throw new Error('Balance is still mounting');
        if (visiblePrompt()) throw new Error('Dialog still open');
      }),
    };
    const page = {
      evaluate: jest.fn(async () => ({
        network: {
          chainId: 5700,
          kind: 'ethereum',
          label: selected ? selectedLabel : 'Syscoin Testnet',
          url: 'http://fixture.invalid',
        },
        networkStatus: contextBusy ? 'switching' : 'idle',
        postLoading,
        switchingAccount: false,
      })),
      getByRole: jest.fn((role, options) => {
        if (role === 'dialog') {
          expect(options.name.test(title)).toBe(true);
          expect(options.name.test('Approve transaction')).toBe(false);
          expect(options.name.test(title + ' extra')).toBe(false);
          expect(
            options.name.test(title.replace(targetLabel, 'Wrong network'))
          ).toBe(false);
          return dialog;
        }
        return group;
      }),
      locator: jest.fn((selector) => (selector === 'li' ? option : balance)),
    };
    const wallet: PaliWallet = Object.assign(
      Object.create(PaliWallet.prototype),
      {
        page,
        ensureOnHome: jest.fn().mockResolvedValue(undefined),
        networkMenuButton: () => header,
      }
    );
    (playwrightExpect.poll as jest.Mock).mockImplementation((read, options) => {
      expect(options.timeout).toBe(120000);
      return {
        toBe: async (expected) => {
          for (let attempt = 0; attempt < 8; attempt++) {
            onPoll(attempt);
            if ((await read()) === expected) return;
          }
          throw new Error('Network not visibly ready');
        },
      };
    });
    return {
      wallet,
      close,
      goToFaucet,
      balance,
      dialog,
      header,
      onPoll: (callback: (attempt: number) => void) => {
        onPoll = callback;
      },
      setBalanceVisible: (value: boolean) => {
        balanceVisible = value;
      },
      setContextBusy: (value: boolean) => {
        contextBusy = value;
      },
      setPostLoading: (value: boolean) => {
        postLoading = value;
      },
      showFaucet: () => {
        delayedFaucet = true;
      },
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it.each(['faucet', 'late'] as const)(
    'closes only the %s first-access prompt before requiring visible readiness',
    async (prompt) => {
      const { wallet, close, goToFaucet, balance } = setup(prompt);
      await wallet.switchNetwork(target);
      expect(close.click).toHaveBeenCalledTimes(1);
      expect(goToFaucet.click).not.toHaveBeenCalled();
      expect(balance.isVisible).toHaveBeenCalled();
    }
  );

  it.each(['approval', 'incomplete'] as const)(
    'does not dismiss an %s dialog or bypass hidden header readiness',
    async (prompt) => {
      const { wallet, close, goToFaucet, balance } = setup(prompt);
      await expect(wallet.switchNetwork(target)).rejects.toThrow(
        'Network not visibly ready'
      );
      expect(close.click).not.toHaveBeenCalled();
      expect(goToFaucet.click).not.toHaveBeenCalled();
      expect(balance.waitFor).not.toHaveBeenCalled();
    }
  );

  it('keeps the ordinary prompt-free network switch path', async () => {
    const { wallet, close, balance } = setup('none');
    await wallet.switchNetwork(target);
    expect(close.click).not.toHaveBeenCalled();
    expect(balance.isVisible).toHaveBeenCalled();
  });

  it.each([
    'Network.test',
    'Network+',
    'Network[dev]',
    'Network $SYS',
    'Network (test)',
  ])('matches only the literal faucet title for %s', async (label) => {
    const { wallet, close } = setup('faucet', label);
    await wallet.switchNetwork(label);
    expect(close.click).toHaveBeenCalledTimes(1);
  });

  it('ignores the custom chain icon number when reading the active label', async () => {
    const { wallet } = setup('none', 'Pali provider edge fixture', '31337');
    expect(await wallet.getActiveNetworkLabel()).toBe('Syscoin Testnet');
  });

  it('switches to a custom network whose icon contains its chain id', async () => {
    const { wallet, header, balance } = setup(
      'none',
      'Pali provider edge fixture',
      '31337'
    );
    await wallet.switchNetwork('Pali provider edge fixture');
    expect(header.innerText).not.toHaveBeenCalled();
    expect(balance.isVisible).toHaveBeenCalled();
  });

  it('does not mistake decorative text for the selected network label', async () => {
    const { wallet, balance } = setup('none', target, target, 'Wrong network');
    await expect(wallet.switchNetwork(target)).rejects.toThrow(
      'Network not visibly ready'
    );
    expect(balance.waitFor).not.toHaveBeenCalled();
  });

  it('waits through header-first switching until the mounted balance and late faucet settle', async () => {
    const test = setup('none');
    test.setBalanceVisible(false);
    test.onPoll((attempt) => {
      if (attempt === 2) {
        test.setBalanceVisible(true);
        test.showFaucet();
      }
    });
    await test.wallet.switchNetwork(target);
    expect(test.close.click).toHaveBeenCalledTimes(1);
    expect(test.goToFaucet.click).not.toHaveBeenCalled();
  });

  it('does not mistake a cached balance during context loading for settled Home', async () => {
    const test = setup('none');
    test.setContextBusy(true);
    test.onPoll((attempt) => {
      if (attempt === 2) {
        test.setContextBusy(false);
        test.showFaucet();
      }
    });
    await test.wallet.switchNetwork(target);
    expect(test.close.click).toHaveBeenCalledTimes(1);
    expect(test.balance.isVisible).toHaveBeenCalled();
  });

  it('rechecks a faucet arriving after the first ready observation', async () => {
    const test = setup('none');
    test.onPoll((attempt) => {
      if (attempt === 1) test.showFaucet();
    });
    await test.wallet.switchNetwork(target);
    expect(test.close.click).toHaveBeenCalledTimes(1);
  });

  it('waits for post-loading even with a cached nonzero balance before it refreshes to zero', async () => {
    const test = setup('none');
    test.setPostLoading(true);
    test.onPoll((attempt) => {
      if (attempt === 2) {
        test.setPostLoading(false);
        test.showFaucet();
      }
    });
    await test.wallet.switchNetwork(target);
    expect(test.close.click).toHaveBeenCalledTimes(1);
    expect(test.goToFaucet.click).not.toHaveBeenCalled();
  });
});
