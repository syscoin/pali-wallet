/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
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
    // This fixture completes a successful ownership read, including another owner.
    pending.get(id)!([{ tokenId: id, verified: true, balance: owned ? 1 : 0 }])
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEmitter.mockReset();
  pending.clear();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
    },
  };
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'fetchNftTokenIds')
      return Promise.resolve({
        tokens: [],
        hasMore: false,
        requiresManualEntry: true,
      });
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

const enumeration = (
  ids: string[],
  hasMore = false,
  requiresManualEntry = true
) => ({
  tokens: ids.map((tokenId) => ({ tokenId, balance: 1 })),
  hasMore,
  requiresManualEntry,
});
const tokenIdCopy = () =>
  screen.queryByRole('button', { name: 'buttons.copy send.tokenId' });
const selectedId = () =>
  tokenIdCopy()?.closest('li')?.querySelector('span')?.textContent;
const enumeratedView = async () => {
  mockEmitter.mockResolvedValueOnce(enumeration(['1', '2']));
  const view = render(<NftsDetails nftData={nft} />);
  await act(async () => undefined);
  expect(selectedId()).toBe('1');
  return view;
};

it.each([
  'unchanged',
  'different chip',
  'chip round trip',
  'manual edit',
  'collection',
  'unmount',
])(
  'associates delayed token-ID copy feedback with the captured selection: %s',
  async (transition) => {
    userEvent.setup();
    let finish!: () => void;
    const write = jest
      .spyOn(navigator.clipboard, 'writeText')
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    try {
      const view = await enumeratedView();
      fireEvent.click(tokenIdCopy()!);
      expect(write).toHaveBeenCalledWith('1');
      if (transition === 'different chip' || transition === 'chip round trip') {
        fireEvent.click(screen.getByRole('button', { name: '#2' }));
        if (transition === 'chip round trip')
          fireEvent.click(screen.getByRole('button', { name: '#1' }));
      }
      if (transition === 'manual edit') await changeManualCopyId();
      if (transition === 'collection')
        view.rerender(
          <NftsDetails
            nftData={{ ...nft, contractAddress: `0x${'cd'.repeat(20)}` }}
          />
        );
      if (transition === 'unmount') view.unmount();
      await act(async () => finish());
      expect(mockAlert.info).toHaveBeenCalledTimes(
        transition === 'unchanged' ? 1 : 0
      );
      expect(mockAlert.error).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  }
);

const changeManualCopyId = async () => {
  fireEvent.change(screen.getByPlaceholderText('send.enterTokenId'), {
    target: { value: '2' },
  });
  await act(async () => undefined);
};

it('reconciles an automatic ID removed by a complete ownership refresh and copies its replacement', async () => {
  userEvent.setup();
  const write = jest
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue(undefined);
  try {
    const view = await enumeratedView();
    mockEmitter.mockResolvedValueOnce(enumeration(['2']));
    await act(async () =>
      view.rerender(<NftsDetails nftData={{ ...nft, balance: 1 }} />)
    );
    expect(screen.queryByRole('button', { name: '#1' })).toBeNull();
    expect(screen.getByRole('button', { name: '#2' })).toBeVisible();
    expect(selectedId()).toBe('2');
    await act(async () => fireEvent.click(tokenIdCopy()!));
    expect(write).toHaveBeenCalledWith('2');
    expect(screen.getByRole('button', { name: '#2' })).toHaveClass(
      'bg-brand-royalblue'
    );
  } finally {
    write.mockRestore();
  }
});

it.each(['zero balance', 'complete empty list'])(
  'clears an automatic ID after an authoritative %s',
  async (kind) => {
    const view = await enumeratedView();
    mockEmitter.mockResolvedValueOnce(enumeration([], false, false));
    await act(async () =>
      view.rerender(
        <NftsDetails
          nftData={{ ...nft, balance: kind === 'zero balance' ? 0 : 1 }}
        />
      )
    );
    expect(tokenIdCopy()).toBeNull();
    expect(screen.queryByRole('button', { name: '#1' })).toBeNull();
  }
);

it.each(['partial', 'manual fallback', 'failed read'])(
  'does not interpret %s enumeration as authoritative removal',
  async (kind) => {
    const view = await enumeratedView();
    const log = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      if (kind === 'failed read')
        mockEmitter.mockRejectedValueOnce(new Error('Enumeration unavailable'));
      else
        mockEmitter.mockResolvedValueOnce(
          kind === 'partial' ? enumeration(['2'], true) : enumeration([])
        );
      await act(async () =>
        view.rerender(<NftsDetails nftData={{ ...nft, balance: 3 }} />)
      );
      expect(selectedId()).toBe('1');
    } finally {
      log.mockRestore();
    }
  }
);

it('preserves deliberate quick selection after a complete refresh removes that ID', async () => {
  const view = await enumeratedView();
  fireEvent.click(screen.getByRole('button', { name: '#2' }));
  mockEmitter.mockResolvedValueOnce(enumeration(['1']));
  await act(async () =>
    view.rerender(<NftsDetails nftData={{ ...nft, balance: 1 }} />)
  );
  expect(selectedId()).toBe('2');
  expect(screen.queryByRole('button', { name: '#2' })).toBeNull();
  expect(screen.queryByTestId('check')).toBeNull();
});

it('preserves manual ID inspection when an enumeration started earlier completes', async () => {
  const view = await enumeratedView();
  let finish!: (value: any) => void;
  mockEmitter.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () =>
    view.rerender(<NftsDetails nftData={{ ...nft, balance: 1 }} />)
  );
  fireEvent.change(screen.getByLabelText('send.tokenId:'), {
    target: { value: '99' },
  });
  await act(async () => finish(enumeration(['2'])));
  expect(screen.getByLabelText('send.tokenId:')).toHaveValue('99');
  expect(selectedId()).toBe('99');
  expect(within(tokenIdCopy()!.closest('li')!).getByText('99')).toBeVisible();
});

it('does not replace the next collection with an old enumeration reply', async () => {
  let finishOld: (value: any) => void = () => undefined;
  mockEmitter.mockImplementation(([, method], args) => {
    if (method === 'fetchNftTokenIds') {
      return args[0] === nft.contractAddress
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve({
            tokens: [{ tokenId: '222', balance: 1 }],
            hasMore: false,
            requiresManualEntry: false,
          });
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
  await act(async () =>
    finishOld({
      tokens: [{ tokenId: '111', balance: 1 }],
      hasMore: false,
      requiresManualEntry: false,
    })
  );
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
  write.mockResolvedValue(undefined);
  await user.keyboard('{Enter}');
  expect(write).toHaveBeenLastCalledWith(nft.contractAddress);
  expect(mockAlert.info).toHaveBeenCalledWith('home.contractCopied');
  write.mockRestore();
});

it('preserves the section and copy-row DOM when rendering collection metadata', () => {
  render(
    <NftsDetails
      nftData={{ ...nft, tokenStandard: 'ERC-1155', tokenId: '123' }}
    />
  );
  for (const [title, childCount] of [
    ['nftDetails.about', 3],
    ['nftDetails.collectionInfo', 2],
    ['nftDetails.technicalInfo', 2],
  ] as const) {
    const heading = screen.getByText(title);
    const section = heading.parentElement!;
    expect(section.tagName).toBe('DIV');
    expect(section.className).toBe(
      'w-full bg-brand-blue800 flex flex-col items-start gap-y-3'
    );
    expect(section.style.borderRadius).toBe('20px');
    expect(section.style.padding).toBe('17px 16px');
    expect(section.children).toHaveLength(childCount);
    expect(section.firstElementChild).toBe(heading);
    expect(heading.className).toBe('font-poppins font-bold text-base');
  }
  for (const [label, rowClass] of [
    [
      'buttons.copy send.tokenId',
      'flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b  border-dashed border-bkg-white200 cursor-default transition-all duration-300',
    ],
    [
      'send.copyContractAddress',
      'flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs  cursor-default transition-all duration-300  border-none',
    ],
  ]) {
    const button = screen.getByRole('button', { name: label });
    const valueGroup = button.parentElement!;
    const row = valueGroup.parentElement!;
    expect(row.tagName).toBe('LI');
    expect(row.className).toBe(rowClass);
    expect(Array.from(row.children).map((element) => element.tagName)).toEqual([
      'P',
      'DIV',
    ]);
    expect(valueGroup.className).toBe(
      'flex items-center font-normal gap-x-1.5 text-xs'
    );
    expect(
      Array.from(valueGroup.children).map((element) => element.tagName)
    ).toEqual(['SPAN', 'BUTTON']);
    expect(button.className).toBe(
      'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-brand-white hover:text-brand-deepPink100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue'
    );
  }
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
