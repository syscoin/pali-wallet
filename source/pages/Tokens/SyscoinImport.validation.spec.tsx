/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';

import { SyscoinImport } from './SyscoinImport';

let mockImport: (asset: any) => Promise<void>;
let mockAsset: any;
jest.mock('components/Icon/Icon', () => ({
  TbFileImport: 'span',
  LoadingOutlined: 'span',
  CheckCircleOutlined: 'span',
  CloseCircleOutlined: 'span',
}));
jest.mock('components/index', () => ({
  ImportableAssetsList: ({ assets, onImport, importedAssetIds }: any) => {
    mockImport = onImport;
    mockAsset = assets[0];
    return (
      <div>
        {assets.map((asset: any) => (
          <button key={asset.id} disabled={importedAssetIds.has(asset.id)}>
            Import {asset.symbol}
          </button>
        ))}
      </div>
    );
  },
}));
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/tokens/add', state: null }),
  useSearchParams: () => [new URLSearchParams('tab=custom'), jest.fn()],
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/index', () => ({
  getCurrentTab: () => 'custom',
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));
jest.mock('utils/tokens', () => ({ getTokenLogo: () => '' }));
jest.mock('./useTokenImportNavigation', () => ({
  useTokenImportNavigation: jest.fn(),
}));
let emitter: jest.Mock;
let pending: Map<string, (value: any) => void>;
const token = (guid: string) => ({
  assetGuid: guid,
  symbol: `SPT${guid}`,
  name: `Token ${guid}`,
  balance: 3,
  decimals: 8,
});
const change = async (guid: string) => {
  fireEvent.change(screen.getByLabelText('tokens.assetGuid'), {
    target: { value: guid },
  });
  await act(async () => jest.advanceTimersByTimeAsync(500));
};
const complete = async (guid: string) => {
  expect(pending.has(guid)).toBe(true);
  await act(async () => pending.get(guid)!(token(guid)));
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  pending = new Map();
  emitter = jest.fn(([, method], args) => {
    if (method === 'getUserOwnedTokens') return Promise.resolve([]);
    if (method === 'validateSPTOnly')
      return new Promise((resolve) => pending.set(args[0], resolve));
    if (method === 'saveTokenInfo') return Promise.resolve(true);
    throw new Error(`Unexpected ${method}`);
  });
  (useController as jest.Mock).mockReturnValue({ controllerEmitter: emitter });
  (useSelector as jest.Mock).mockImplementation((select) =>
    select({
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: {
          HDAccount: { 0: { address: 'synthetic', xpub: 'public' } },
        },
        activeNetwork: { chainId: 5700 },
        accountAssets: {},
      },
    })
  );
});
afterEach(() => jest.useRealTimers());

it('keeps a newer SPT selection when an older validation finishes last', async () => {
  render(<SyscoinImport />);
  await change('1');
  await change('2');
  await complete('2');
  await complete('1');
  expect(screen.queryByRole('button', { name: 'Import SPT1' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Import SPT2' })).toBeTruthy();
});

it('removes an importable SPT immediately when its identifier is edited', async () => {
  render(<SyscoinImport />);
  await change('1');
  await complete('1');
  fireEvent.change(screen.getByLabelText('tokens.assetGuid'), {
    target: { value: '2' },
  });
  expect(screen.queryByRole('button', { name: 'Import SPT1' })).toBeNull();
});

it('reports a failed SPT save as failure rather than successful import', async () => {
  render(<SyscoinImport />);
  await change('1');
  await complete('1');
  emitter.mockImplementation(([, method]) =>
    method === 'saveTokenInfo'
      ? Promise.reject(new Error('Synthetic save failed'))
      : Promise.resolve([])
  );
  await act(async () => {
    await expect(mockImport(mockAsset)).rejects.toThrow(
      'Synthetic save failed'
    );
  });
  expect(mockAlert.error).toHaveBeenCalledWith('Synthetic save failed');
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: 'Import SPT1' }).hasAttribute('disabled')
  ).toBe(false);
});
