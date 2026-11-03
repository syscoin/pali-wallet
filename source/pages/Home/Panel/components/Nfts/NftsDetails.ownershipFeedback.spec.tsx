/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { JsonRpcProvider } from 'ethers/providers';
import React from 'react';

import { verifyERC721OwnershipHelper } from 'scripts/Background/controllers/assets/nft-utils';
import { Interface } from 'utils/ethersV6Compat';

import { NftsDetails } from './NftsDetails';

const OWNER = '0x0000000000000000000000000000000000000001';
const OTHER = '0x0000000000000000000000000000000000000002';
const CONTRACT = '0x0000000000000000000000000000000000000721';
const abi = new Interface(['function ownerOf(uint256) view returns (address)']);
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const calls: string[] = [];
let mockMode:
  | 'owned'
  | 'other'
  | 'unminted'
  | 'transport'
  | 'malformed'
  | 'call-exception';

jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        activeNetwork: {
          chainId: 1,
          kind: 'ethereum',
          url: 'https://rpc.invalid',
        },
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: { 0: { type: 'HDAccount', id: 0, address: OWNER } },
        },
      },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert }),
  useAdjustedExplorer: () => 'https://explorer.invalid',
}));
jest.mock('../../../useHomeBrowsingState', () => ({
  getHomeBrowsingScope: () => 'synthetic-current-account-network',
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
  contractAddress: CONTRACT,
  tokenStandard: 'ERC-721',
  name: 'Synthetic NFT',
  chainId: 1,
  balance: 1,
};
const invalidId = () =>
  Object.assign(new Error('ERC721: invalid token ID'), {
    code: 'CALL_EXCEPTION',
  });
const provider = {
  call: async (transaction: { data: string }) => {
    const decoded = abi.parseTransaction(transaction)!;
    const tokenId = decoded.args[0].toString();
    calls.push(tokenId);
    if (tokenId !== '7' || mockMode === 'unminted') throw invalidId();
    if (mockMode === 'transport')
      throw Object.assign(new Error('Synthetic RPC connection unavailable'), {
        code: 'NETWORK_ERROR',
      });
    if (mockMode === 'call-exception') {
      // ethers maps JSON-RPC eth_call errors to CALL_EXCEPTION even when no
      // revert data exists, so the error code alone cannot attest nonownership.
      const error = JsonRpcProvider.prototype.getRpcError.call(
        {} as JsonRpcProvider,
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [transaction, 'latest'],
        },
        { error: { code: -32005, message: 'Synthetic RPC rate limit' } }
      );
      expect((error as Error & { code: string }).code).toBe('CALL_EXCEPTION');
      throw error;
    }
    if (mockMode === 'malformed') return '0x';
    return abi.encodeFunctionResult('ownerOf', [
      mockMode === 'other' ? OTHER : OWNER,
    ]);
  },
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  calls.length = 0;
  mockMode = 'owned';
  jest.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
    array.fill(0);
    array[31] = 42;
    return array;
  });
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'fetchNftTokenIds')
      return Promise.resolve({
        tokens: [],
        hasMore: false,
        requiresManualEntry: true,
      });
    if (method === 'verifyERC721Ownership')
      return verifyERC721OwnershipHelper(
        args[0],
        args[1],
        args[2],
        provider as any
      );
    throw new Error(`Unexpected controller method ${method}`);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const enterManualId = async () => {
  render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  fireEvent.change(screen.getByLabelText('send.tokenId:'), {
    target: { value: '7' },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'verifyERC721Ownership'],
    [CONTRACT, OWNER, ['7']]
  );
  expect(calls).toEqual(['42', '7']);
  expect(screen.queryByTestId('verifying')).toBeNull();
};

it('healthy owned token displays confirmed ownership', async () => {
  await enterManualId();
  expect(screen.getByTestId('check')).toBeTruthy();
  expect(screen.queryByText(/send.youDontOwnThisToken/)).toBeNull();
});

it('a successful other owner response displays not owned', async () => {
  mockMode = 'other';
  await enterManualId();
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
  expect(screen.queryByTestId('check')).toBeNull();
});

it.each(['transport', 'malformed', 'call-exception', 'unminted'] as const)(
  'does not turn %s verification failure into a claim that the user does not own token 7',
  async (mode) => {
    mockMode = mode;
    await enterManualId();
    expect(screen.queryByTestId('check')).toBeNull();
    expect(screen.queryByText(/send.youDontOwnThisToken/)).toBeNull();
    expect(
      screen.getByText(/send.tokenVerificationFailed|send.verificationFailed/)
    ).toBeTruthy();
  }
);
