/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import { INetwork, INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { NetworkList } from './NetworkList';

// Real picker, Button, NetworkInfo, ChainIcon/local SVGs and native controls.
// Only store hooks and the finite controller transport are substituted. The
// browser proof separately exercises real registration/persistence and errors.
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockError = jest.fn();
const mockChainLookup = jest.fn();
let mockState: any;
let mockLanguage: 'en' | 'fr' | 'de' = 'en';
const originalFetch = global.fetch;
const SHARED = 'Shared test network';

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const catalog = jest.requireActual(`assets/locales/${mockLanguage}.json`);
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], catalog);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => ({}) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: mockError } }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockChainLookup(...args),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
// Preserve installed local glyphs under Jest's CJS entry.
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);

const catalog = () => ({ en, fr, de }[mockLanguage]);
const chainLabel = (chainId: number) =>
  catalog().settings.chainNumber.replace('{{chainId}}', String(chainId));
const fallback = (chainId: number) =>
  catalog().switchNetworkPage.chainFallback.replace(
    '{{chainId}}',
    String(chainId)
  );
const family = (kind: INetworkType) =>
  kind === INetworkType.Syscoin ? 'UTXO' : 'EVM';
const cue = (kind: INetworkType, chainId: number) =>
  `${family(kind)} · ${chainLabel(chainId)}`;
const choiceTitle = (kind: INetworkType, chainId: number, label = SHARED) =>
  `${label} (${cue(kind, chainId)})`;

function configure(kind: INetworkType, labels: readonly string[]) {
  const ids = kind === INetworkType.Syscoin ? [57, 5700] : [5, 11155111];
  const active: INetwork = {
    kind,
    chainId: kind === INetworkType.Syscoin ? 0 : 1,
    slip44: kind === INetworkType.Syscoin ? 0 : 60,
    label: 'Active control',
    currency: kind === INetworkType.Syscoin ? 'btc' : 'eth',
    url: 'https://active.synthetic.invalid',
  };
  const choices: INetwork[] = ids.map((chainId, index) => ({
    ...active,
    chainId,
    label: labels[index],
    slip44: kind === INetworkType.Syscoin ? (chainId === 57 ? 57 : 1) : 60,
    // Synthetic credentials/keys must never become visible or accessible cues.
    url: `https://rpc-user:rpc-password@rpc-${chainId}.synthetic.invalid/private?apiKey=rpc-secret-${chainId}`,
    apiUrl: `https://explorer.synthetic.invalid/api?apikey=explorer-secret-${chainId}`,
    key: `registry-secret-${chainId}`,
  }));
  mockState = {
    vault: {
      isBitcoinBased: kind === INetworkType.Syscoin,
      activeNetwork: active,
    },
    vaultGlobal: {
      networks: {
        ethereum: {},
        syscoin: {},
        [kind]: Object.fromEntries(
          [active, ...choices].map((network) => [network.chainId, network])
        ),
      },
    },
  };
  return { active, choices };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'en';
  mockEmitter.mockResolvedValue(undefined);
  mockChainLookup.mockImplementation(() => {
    throw new Error('Known local chain icons must not request metadata');
  });
  global.fetch = jest.fn(async () => {
    throw new Error('No network allowed in picker component proof');
  });
});
afterEach(() => {
  cleanup();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockChainLookup).not.toHaveBeenCalled();
  expect(mockError).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  global.fetch = originalFetch;
});

const noPrivateConfiguration = () => {
  for (const value of [
    'rpc-user',
    'rpc-password',
    'rpc-secret',
    'explorer-secret',
    'registry-secret',
    'synthetic.invalid',
  ])
    expect(document.body.innerHTML).not.toContain(value);
};
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  target: HTMLElement
) {
  for (let index = 0; index < 20; index++) {
    if (document.activeElement === target) break;
    await user.tab();
  }
  expect(target).toHaveFocus();
}

describe.each(['en', 'fr', 'de'] as const)(
  'recovery choice identity in %s',
  (language) => {
    it.each([
      { mode: 'duplicate', labels: [SHARED, SHARED] },
      { mode: 'blank fallback', labels: ['', ''] },
      { mode: 'unique control', labels: ['Goerli control', 'Sepolia control'] },
    ])(
      'renders $mode without exposing RPC configuration',
      ({ mode, labels }) => {
        mockLanguage = language;
        const { choices } = configure(INetworkType.Ethereum, labels);
        render(<NetworkList />);
        for (const [index, choice] of choices.entries()) {
          const duplicate = mode === 'duplicate';
          const label = labels[index] || fallback(choice.chainId);
          const title = duplicate
            ? choiceTitle(choice.kind, choice.chainId, label)
            : label;
          const row = screen.getByTitle(title);
          expect(row).toHaveAttribute('aria-pressed', 'false');
          expect(row).toHaveAccessibleName(
            duplicate ? `${label} ${cue(choice.kind, choice.chainId)}` : label
          );
          expect(
            within(row).getByText(label, { exact: true })
          ).toBeInTheDocument();
          if (duplicate) {
            expect(
              within(row).getByText(cue(choice.kind, choice.chainId), {
                exact: true,
              })
            ).toHaveClass('text-content-muted');
          } else {
            expect(row).not.toHaveTextContent(cue(choice.kind, choice.chainId));
            expect(row.querySelector('span.block')).toBeNull();
          }
        }
        noPrivateConfiguration();
        expect(mockEmitter).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
      }
    );

    it('retains the Active cue in the duplicate button native accessible name', () => {
      mockLanguage = language;
      const { choices } = configure(INetworkType.Ethereum, [SHARED, SHARED]);
      mockState.vault.activeNetwork = choices[0];
      render(<NetworkList />);
      const active = screen.getByTitle(
        choiceTitle(INetworkType.Ethereum, choices[0].chainId)
      );
      expect(active).toHaveAccessibleName(
        `${SHARED} ${cue(INetworkType.Ethereum, choices[0].chainId)} (${
          catalog().components.activeStatus
        })`
      );
      expect(active).toHaveAttribute('aria-pressed', 'true');
      expect(
        within(active).getByText(`(${catalog().components.activeStatus})`, {
          exact: true,
        })
      ).toBeInTheDocument();
      noPrivateConfiguration();
      expect(mockEmitter).not.toHaveBeenCalled();
    });

    it.each([
      { kind: INetworkType.Ethereum, method: 'pointer' },
      { kind: INetworkType.Ethereum, method: 'keyboard' },
      { kind: INetworkType.Syscoin, method: 'pointer' },
      { kind: INetworkType.Syscoin, method: 'keyboard' },
    ] as const)(
      'keeps exact keyed $kind configuration through $method selection',
      async ({ kind, method }) => {
        mockLanguage = language;
        const { choices } = configure(kind, [SHARED, SHARED]);
        const user = userEvent.setup();
        render(<NetworkList />);
        for (const [index, choice] of choices.entries()) {
          const row = screen.getByTitle(choiceTitle(kind, choice.chainId));
          if (method === 'pointer') await user.click(row);
          else {
            await tabTo(user, row);
            await user.keyboard('{Enter}');
          }
          expect(row).toHaveAttribute('aria-pressed', 'true');
          expect(
            screen.getByTitle(
              choiceTitle(kind, choices[index === 0 ? 1 : 0].chainId)
            )
          ).toHaveAttribute('aria-pressed', 'false');
          const connect = screen.getByRole('button', {
            name: catalog().buttons.connect,
          });
          if (method === 'pointer') await user.click(connect);
          else {
            await tabTo(user, connect);
            await user.keyboard('{Enter}');
          }
          await waitFor(() =>
            expect(mockEmitter).toHaveBeenCalledTimes(index + 1)
          );
          expect(mockEmitter).toHaveBeenNthCalledWith(
            index + 1,
            ['wallet', 'setActiveNetwork'],
            [choice, false]
          );
          expect(mockEmitter.mock.calls[index][1][0]).toBe(choice);
          await waitFor(() =>
            expect(mockNavigate).toHaveBeenCalledTimes(index + 1)
          );
          expect(mockNavigate).toHaveBeenLastCalledWith('/home');
          noPrivateConfiguration();
        }
      }
    );
  }
);
