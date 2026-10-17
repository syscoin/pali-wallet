/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { NftsDetails } from './NftsDetails';

let mockState: any;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
  }),
  useAdjustedExplorer: () => 'https://synthetic.example/',
}));
jest.mock('../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: (account: any, network: any) =>
    `${account.address}:${network.chainId}`,
  useHomeBrowsingState: (_key: string, _scope: string, initial: any) =>
    React.useState(initial),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  LoadingOutlined: () => <span data-testid="verifying" />,
  Icon: ({ name }: { name: string }) => <span data-testid={name} />,
}));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const nft = {
  contractAddress: `0x${'ab'.repeat(20)}`,
  tokenStandard: 'ERC-721',
  name: 'Synthetic NFT',
  chainId: 57057,
  balance: 2,
};
const pending = new Map<string, (value: any) => void>();
const change = async (value: string, delay = 500) => {
  fireEvent.change(screen.getByPlaceholderText('send.enterTokenId'), {
    target: { value },
  });
  await act(async () => jest.advanceTimersByTimeAsync(delay));
};
const complete = async (id: string, owned: boolean) => {
  expect(pending.has(id)).toBe(true);
  await act(async () =>
    pending.get(id)!([{ tokenId: id, verified: owned, balance: owned ? 1 : 0 }])
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  pending.clear();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
    },
  };
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'fetchNftTokenIds') return Promise.resolve([]);
    if (method === 'verifyERC721Ownership')
      return new Promise((resolve) => pending.set(args[2][0], resolve));
    throw new Error(`Unexpected ${method}`);
  });
});
afterEach(() => jest.useRealTimers());

it('keeps the newest token ownership result when a previous read finishes last', async () => {
  render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  await change('1');
  await change('2');
  await complete('2', false);
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
  await complete('1', true);
  expect(screen.queryByTestId('check')).toBeNull();
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
});

it('debounces rapid token ID edits to one ownership read', async () => {
  render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  await change('1', 100);
  await change('12', 100);
  await change('123', 500);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'verifyERC721Ownership'
    )
  ).toHaveLength(1);
  expect(pending.has('123')).toBe(true);
});

it('cancels a scheduled ownership read when the details view closes', async () => {
  const view = render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  await change('123', 100);
  view.unmount();
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(pending.size).toBe(0);
});

it('clearing a token ID invalidates its pending result and technical-info value', async () => {
  render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  await change('123');
  await change('', 0);
  await complete('123', true);
  expect(screen.queryByTestId('check')).toBeNull();
  expect(screen.queryByText('123')).toBeNull();
  expect(
    (screen.getByLabelText('send.tokenId:') as HTMLInputElement).value
  ).toBe('');
});

it('ignores an ownership reply from the previous account', async () => {
  const view = render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  await change('1');
  mockState.vault.accounts.HDAccount[0].address = `0x${'22'.repeat(20)}`;
  view.rerender(<NftsDetails nftData={nft} />);
  await complete('1', true);
  expect(screen.queryByTestId('check')).toBeNull();
});

it('does not enumerate the same collection again for a refreshed metadata object', async () => {
  const view = render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  view.rerender(<NftsDetails nftData={{ ...nft }} />);
  await act(async () => undefined);
  expect(
    mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'fetchNftTokenIds'
    )
  ).toHaveLength(1);
});

it('does not replace the next collection with an old enumeration reply', async () => {
  let finishOld: (value: any) => void = () => undefined;
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'fetchNftTokenIds') {
      return args[0] === nft.contractAddress
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve([{ tokenId: '222', balance: 1 }]);
    }
    throw new Error(`Unexpected ${method}`);
  });
  const view = render(<NftsDetails nftData={nft} />);
  view.rerender(
    <NftsDetails
      nftData={{ ...nft, contractAddress: `0x${'cd'.repeat(20)}` }}
    />
  );
  await act(async () => undefined);
  expect(screen.getByRole('button', { name: '#222' })).toBeTruthy();
  await act(async () => finishOld([{ tokenId: '111', balance: 1 }]));
  expect(screen.queryByRole('button', { name: '#111' })).toBeNull();
  expect(screen.getByRole('button', { name: '#222' })).toBeTruthy();
});

it('copies the public token ID and contract with keyboard controls and handles refusal', async () => {
  jest.useRealTimers();
  const user = userEvent.setup();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined);
  render(
    <NftsDetails
      nftData={{ ...nft, tokenStandard: 'ERC-1155', tokenId: '123' }}
    />
  );
  const tokenCopy = screen.getByRole('button', {
    name: 'buttons.copy send.tokenId',
  });
  tokenCopy.focus();
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenCalledWith('123');
  expect(mockAlert.info).toHaveBeenCalledWith('components.copied');
  mockAlert.info.mockClear();
  write.mockRejectedValue(new Error('denied'));
  const contractCopy = screen.getByRole('button', {
    name: 'send.copyContractAddress',
  });
  contractCopy.focus();
  await user.keyboard('{Enter}');
  expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockAlert.info).not.toHaveBeenCalled();
  write.mockRestore();
});

it('does not announce a delayed public copy after the details page closes', async () => {
  jest.useRealTimers();
  const user = userEvent.setup();
  let finishCopy!: () => void;
  const write = jest.spyOn(navigator.clipboard, 'writeText').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishCopy = resolve;
      })
  );
  const view = render(
    <NftsDetails
      nftData={{ ...nft, tokenStandard: 'ERC-1155', tokenId: '123' }}
    />
  );
  await user.click(
    screen.getByRole('button', { name: 'send.copyContractAddress' })
  );
  view.unmount();
  await act(async () => finishCopy());
  expect(mockAlert.info).not.toHaveBeenCalled();
  expect(mockAlert.error).not.toHaveBeenCalled();
  write.mockRestore();
});
