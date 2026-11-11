/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import { formatTokenUnits } from '../../shared/erc20';
import { KeyringAccountType } from 'types/network';
import { Interface } from 'utils/ethersV6Compat';

import { AssetTransferSummary } from './components/AssetTransferSummary';
import { useAssetTransferSummaries } from './useAssetTransferSummaries';

const ACCOUNT = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const RECIPIENT = `0x${'33'.repeat(20)}`;
const OTHER = `0x${'44'.repeat(20)}`;
const MAX =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const context = {
  account: { address: ACCOUNT, id: 0, type: KeyringAccountType.HDAccount },
  chainId: 1,
  rpcUrl: 'rpc-a',
  slip44: 60,
};
let mockState: any;
const mockRead = jest.fn();
const mockType = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: (...args: any[]) =>
      args[0][1] === 'checkContractType'
        ? mockType(...args)
        : mockRead(...args),
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const words = jest.requireActual(
        '../../assets/locales/en.json'
      ).assetTransfer;
      return key.startsWith('assetTransfer.')
        ? words[key.slice('assetTransfer.'.length)]
        : key;
    },
  }),
}));
const encode = (signature: string, args: unknown[]) =>
  new Interface([`function ${signature}`]).encodeFunctionData(signature, args);
const transfer = (units = MAX) =>
  encode('transfer(address,uint256)', [RECIPIENT, units]);
function Harness({
  calls,
  request = 'original',
}: {
  calls: { data: string; to: string }[];
  request?: string;
}) {
  const summaries = useAssetTransferSummaries(calls, context, request);
  return (
    <>
      {summaries.map(
        (summary, index) =>
          summary && <AssetTransferSummary key={index} transfer={summary} />
      )}
    </>
  );
}
const summary = () =>
  screen.getByRole('region', { name: 'Asset transfer details' });
beforeEach(() => {
  mockRead.mockReset();
  mockType.mockReset().mockResolvedValue({ type: 'ERC-20' });
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: { 0: { address: ACCOUNT }, 1: { address: OTHER } },
      },
      activeNetwork: { chainId: 1, url: 'rpc-a' },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
});
afterEach(cleanup);

it('shows exact 255-decimal ERC20 amount and identifies contract-supplied metadata', async () => {
  mockRead.mockResolvedValue({
    name: 'Synthetic',
    symbol: 'SYN',
    decimals: 255,
  });
  render(<Harness calls={[{ to: CONTRACT, data: transfer() }]} />);
  expect(await screen.findByText('SYN')).toBeVisible();
  expect(within(summary()).getByText(formatTokenUnits(MAX, 255))).toBeVisible();
  expect(within(summary()).getByText(RECIPIENT)).toBeVisible();
  expect(within(summary()).getByText(CONTRACT)).toBeVisible();
  expect(
    screen.getByText('Token metadata is supplied by the contract.')
  ).toBeVisible();
  expect(mockRead).toHaveBeenCalledWith(
    ['wallet', 'getERC20TokenInfo'],
    [CONTRACT, ACCOUNT, context]
  );
});

it.each([
  undefined,
  { name: 'Conflict', symbol: 'BAD', decimals: -1 },
  { name: 'Conflict', symbol: 'BAD', decimals: 256 },
])(
  'retains raw unknown units when strict metadata is absent or invalid (%j)',
  async (metadata) => {
    mockRead.mockResolvedValue(metadata);
    render(<Harness calls={[{ to: CONTRACT, data: transfer() }]} />);
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    expect(screen.getByText(MAX)).toBeVisible();
    expect(screen.getByText('Base units / token ID')).toBeVisible();
    expect(screen.getByText('Token standard unverified')).toBeVisible();
    expect(screen.queryByText('BAD')).not.toBeInTheDocument();
  }
);

it('shows canonical NFT owner, recipient and exact token ID without claiming verified standard', () => {
  const data = encode('safeTransferFrom(address,address,uint256)', [
    ACCOUNT,
    RECIPIENT,
    MAX,
  ]);
  render(<Harness calls={[{ to: CONTRACT, data }]} />);
  expect(screen.getByText(`#${MAX}`)).toBeVisible();
  expect(screen.getByText('1 units')).toBeVisible();
  expect(screen.getByText(ACCOUNT)).toBeVisible();
  expect(screen.getByText('Token standard unverified')).toBeVisible();
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockType).not.toHaveBeenCalled();
});

it('classifies ambiguous transferFrom through ERC165 before considering decimals', async () => {
  mockType.mockResolvedValue({ type: 'ERC-721' });
  // This NFT implements all fungible-looking metadata methods too.
  mockRead.mockResolvedValue({
    name: 'NFT with decimals',
    symbol: 'FAKE20',
    decimals: 18,
  });
  const data = encode('transferFrom(address,address,uint256)', [
    ACCOUNT,
    RECIPIENT,
    MAX,
  ]);
  render(<Harness calls={[{ to: CONTRACT, data }]} />);
  expect(await screen.findByText('NFT transfer')).toBeVisible();
  expect(screen.getByText(`#${MAX}`)).toBeVisible();
  expect(screen.getByText('1 units')).toBeVisible();
  expect(mockType).toHaveBeenCalledWith(
    ['wallet', 'checkContractType'],
    [CONTRACT, ACCOUNT, context]
  );
  expect(mockRead).not.toHaveBeenCalled();
  expect(screen.queryByText('FAKE20')).not.toBeInTheDocument();
});

it.each(['Unknown', 'ERC-1155', 'ERC-777', undefined])(
  'keeps ambiguous transferFrom raw without matching type proof (%s)',
  async (type) => {
    mockType.mockResolvedValue({ type });
    mockRead.mockResolvedValue({
      name: 'Misleading metadata',
      symbol: 'FAKE20',
      decimals: 18,
    });
    const data = encode('transferFrom(address,address,uint256)', [
      ACCOUNT,
      RECIPIENT,
      MAX,
    ]);
    render(<Harness calls={[{ to: CONTRACT, data }]} />);
    await waitFor(() => expect(mockType).toHaveBeenCalledTimes(1));
    expect(screen.getByText(MAX)).toBeVisible();
    expect(screen.getByText('Base units / token ID')).toBeVisible();
    expect(screen.getByText('Token standard unverified')).toBeVisible();
    expect(mockRead).not.toHaveBeenCalled();
    expect(screen.queryByText('FAKE20')).not.toBeInTheDocument();
  }
);

it('does not turn an incompatible plain transfer on an NFT contract into fungible units', async () => {
  mockType.mockResolvedValue({ type: 'ERC-721' });
  render(<Harness calls={[{ to: CONTRACT, data: transfer() }]} />);
  await waitFor(() => expect(mockType).toHaveBeenCalledTimes(1));
  expect(screen.getByText(MAX)).toBeVisible();
  expect(screen.getByText('Token standard unverified')).toBeVisible();
  expect(mockRead).not.toHaveBeenCalled();
});

it('does not begin the fungible metadata read after its type proof loses the selected owner', async () => {
  let release!: (value: unknown) => void;
  mockType.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const calls = [{ to: CONTRACT, data: transfer() }];
  const view = render(<Harness calls={calls} />);
  await waitFor(() => expect(mockType).toHaveBeenCalledTimes(1));
  mockState.vault.activeAccount.id = 1;
  view.rerender(<Harness calls={calls} />);
  await act(async () => release({ type: 'ERC-20' }));
  expect(mockRead).not.toHaveBeenCalled();
  expect(screen.getByText(MAX)).toBeVisible();
  expect(screen.getByText('Token standard unverified')).toBeVisible();
});

it('keeps ERC1155 batch IDs and quantities paired, including zero ID and huge quantity', () => {
  const data = encode(
    'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)',
    [ACCOUNT, RECIPIENT, [0, 9], [MAX, 3], '0x']
  );
  render(<Harness calls={[{ to: CONTRACT, data }]} />);
  expect(screen.getByText('#0').parentElement).toHaveTextContent(
    `${MAX} units`
  );
  expect(screen.getByText('#9').parentElement).toHaveTextContent('3 units');
  expect(mockRead).not.toHaveBeenCalled();
});

it('does not describe noncanonical calldata as a transfer', () => {
  render(<Harness calls={[{ to: CONTRACT, data: `${transfer()}00` }]} />);
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
  expect(mockRead).not.toHaveBeenCalled();
});

it('deduplicates repeated contract reads while retaining each call amount', async () => {
  mockRead.mockResolvedValue({ name: 'Token', symbol: 'TOK', decimals: 0 });
  render(
    <Harness
      calls={[
        { to: CONTRACT, data: transfer('7') },
        { to: CONTRACT, data: transfer('8') },
      ]}
    />
  );
  await waitFor(() => expect(screen.getAllByText('TOK')).toHaveLength(2));
  expect(screen.getByText('7')).toBeVisible();
  expect(screen.getByText('8')).toBeVisible();
  expect(mockRead).toHaveBeenCalledTimes(1);
  expect(mockType).toHaveBeenCalledTimes(1);
});

it('retires a held result when the reviewed calldata changes', async () => {
  let release!: (value: unknown) => void;
  mockRead
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    )
    .mockRejectedValue(new Error('unavailable'));
  const view = render(
    <Harness calls={[{ to: CONTRACT, data: transfer('7') }]} />
  );
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  view.rerender(<Harness calls={[{ to: CONTRACT, data: transfer('8') }]} />);
  await act(async () => release({ name: 'Old', symbol: 'OLD', decimals: 0 }));
  expect(screen.getByText('8')).toBeVisible();
  expect(screen.queryByText('OLD')).not.toBeInTheDocument();
});

it.each(['account', 'network', 'rpc'])(
  'rechecks %s context before starting the next contract read',
  async (boundary) => {
    let release!: (value: unknown) => void;
    mockRead.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const calls = [
      { to: CONTRACT, data: transfer('7') },
      { to: OTHER, data: transfer('8') },
    ];
    const view = render(<Harness calls={calls} />);
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    if (boundary === 'account') mockState.vault.activeAccount.id = 1;
    else if (boundary === 'network') mockState.vault.activeNetwork.chainId = 2;
    else mockState.vault.activeNetwork.url = 'rpc-b';
    view.rerender(<Harness calls={calls} />);
    await act(async () => release({ name: 'Old', symbol: 'OLD', decimals: 0 }));
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  }
);

it('does not revive pre-transition metadata after account ABA', async () => {
  const releases: ((value: unknown) => void)[] = [];
  mockRead.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(resolve);
      })
  );
  const calls = [{ to: CONTRACT, data: transfer('7') }];
  const view = render(<Harness calls={calls} />);
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
  mockState.vault.activeAccount.id = 1;
  view.rerender(<Harness calls={calls} />);
  mockState.vault.activeAccount.id = 0;
  view.rerender(<Harness calls={calls} />);
  await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
  await act(async () =>
    releases[0]({ name: 'Old', symbol: 'OLD', decimals: 0 })
  );
  expect(screen.queryByText('OLD')).not.toBeInTheDocument();
  await act(async () =>
    releases[1]({ name: 'Fresh', symbol: 'NEW', decimals: 0 })
  );
  expect(screen.getByText('NEW')).toBeVisible();
});
