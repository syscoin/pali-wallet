/** @jest-environment jsdom */

import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';

import CustomRPC from './CustomRPC';
import EditAccount from './EditAccount';
import ForgetWallet from './ForgetWallet';
import TrustedSites from './TrustedSites';

let mockState: any;
let mockLocation: any;
let mockHooks: any[];
let mockHookIndex: number;
let mockEffects: Array<() => any>;
let mockScope: { account: string; network: string };
let mockStatus: {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};
const mockNavigate = jest.fn();
const mockNavigateBack = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
const mockForm = {
  validateFields: jest.fn(),
  setFields: jest.fn(),
  setFieldsValue: jest.fn(),
  getFieldValue: jest.fn(),
};
const rpc = {
  chainId: 12345,
  kind: INetworkType.Ethereum,
  url: 'https://rpc.example',
  label: 'Test',
  currency: 'eth',
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: mockAlert,
    useCopyClipboard: () => [false, jest.fn()],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
  createBrowsingNavigationContext: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .createBrowsingNavigationContext(...args),
  navigateBack: (...args: any[]) => mockNavigateBack(...args),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
}));
jest.mock('utils/index', () => ({ truncate: (value: string) => value }));
jest.mock('antd', () => ({
  Form: Object.assign(() => null, {
    Item: 'form-item',
    useForm: () => [mockForm],
  }),
  Input: 'input',
}));
jest.mock('antd/lib/form/Form', () => ({ useForm: () => [mockForm] }));
jest.mock('components/index', () => ({
  Button: 'button',
  Tooltip: 'span',
  Card: 'div',
  SeedPhraseDisplay: 'seed-display',
  ValidatedPasswordInput: 'password-input',
  Icon: 'icon',
}));
jest.mock('components/Icon', () => ({ Icon: 'icon' }));
jest.mock('components/Icon/Icon', () => ({ LockIconSvg: 'icon' }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: 'icon' }));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: 'status-modal',
}));
jest.mock('@headlessui/react', () => ({ Switch: 'switch' }));
jest.mock('qrcode.react', () => ({ QRCodeSVG: 'qr-code' }));
jest.mock('constants/trustedApps.json', () => [
  'https://trusted.example',
  'https://other.example',
]);

const find = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const match = find(child.props.children, predicate);
    if (match) return match;
  }
  return undefined;
};
const render = (view: () => React.ReactNode) => {
  mockHookIndex = 0;
  mockEffects = [];
  return view();
};

describe('settings browsing context', () => {
  beforeEach(() => {
    mockHooks = [];
    mockScope = { account: 'account-a', network: 'network-a' };
    mockStatus = {
      isUnlocked: true,
      isLoading: false,
      connectionUnavailable: false,
    };
    window.history.replaceState(null, '', '/app.html');
    mockLocation = {
      pathname: '/settings/networks/custom-rpc',
      search: '',
      hash: '',
      state: { returnContext: { returnRoute: '/home/smart-account' } },
    };
    mockState = {
      vault: {
        accounts: {
          HDAccount: {
            0: {
              id: 0,
              label: 'Current label',
              address: 'current-address',
              balances: { ethereum: 0, syscoin: 0 },
            },
          },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        isBitcoinBased: false,
      },
      vaultGlobal: { networks: { syscoin: {}, ethereum: {} } },
    };
    mockNavigate.mockReset();
    mockNavigateBack.mockReset();
    mockNavigateWithContext.mockReset();
    mockAlert.success.mockReset();
    mockAlert.error.mockReset();
    mockForm.validateFields.mockReset().mockResolvedValue(undefined);
    mockForm.setFields.mockReset();
    mockForm.setFieldsValue.mockReset();
    mockEmitter.mockReset().mockImplementation(async (method: string[]) => {
      if (method[1] === 'getRpc') return rpc;
      if (method[1] === 'getChainData') return [];
      return undefined;
    });
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = mockHookIndex++;
      if (!(index in mockHooks))
        mockHooks[index] = typeof initial === 'function' ? initial() : initial;
      return [
        mockHooks[index],
        (value: any) => {
          mockHooks[index] =
            typeof value === 'function' ? value(mockHooks[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((callback) => callback());
    jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
    jest
      .spyOn(React, 'useRef')
      .mockImplementation((initial) => ({ current: initial }));
    jest.spyOn(React, 'useEffect').mockImplementation((callback) => {
      mockEffects.push(callback);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['add', 'edit'])(
    'returns a successful %s RPC operation to its caller instead of browser history',
    async (mode) => {
      if (mode === 'edit') {
        mockState.vaultGlobal.networks.ethereum[rpc.chainId] = rpc;
        mockLocation.state = {
          ...mockLocation.state,
          isEditing: true,
          selected: rpc,
        };
      }
      const view = render(CustomRPC);
      await find(
        view,
        (element) => typeof element.props.onFinish === 'function'
      )!.props.onFinish({
        label: 'Test',
        url: rpc.url,
        chainId: rpc.chainId,
        symbol: 'ETH',
        apiUrl: '',
      });
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', mode === 'edit' ? 'editCustomRpc' : 'addCustomRpc'],
        [expect.objectContaining({ chainId: rpc.chainId })]
      );
      expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
      expect(mockNavigate).not.toHaveBeenCalled();
    }
  );

  it.each(
    ['form', 'rpc', 'api', 'mutation'].flatMap((stage) =>
      [
        'account',
        'network',
        'route',
        'native-key',
        'lock',
        'connection',
        'unmount',
      ].map((change) => ({ stage, change }))
    )
  )(
    'ignores a deferred $stage RPC Save continuation after $change changes',
    async ({ stage, change }) => {
      mockLocation.key = 'rpc-entry';
      window.history.replaceState(
        { key: 'rpc-entry' },
        '',
        '/app.html#/settings/networks/custom-rpc'
      );
      let finish!: (value?: any) => void;
      const deferred = new Promise((resolve) => {
        finish = resolve;
      });
      if (stage === 'form') mockForm.validateFields.mockReturnValue(deferred);
      mockEmitter.mockImplementation(async (method: string[]) => {
        if (method[1] === 'getRpc') return stage === 'rpc' ? deferred : rpc;
        if (method[1] === 'testExplorerApi')
          return stage === 'api' ? deferred : { success: true };
        if (method[1] === 'addCustomRpc')
          return stage === 'mutation' ? deferred : undefined;
        return undefined;
      });
      const view = render(CustomRPC);
      const pending = find(
        view,
        (element) => typeof element.props.onFinish === 'function'
      )!.props.onFinish({
        label: 'Test',
        url: rpc.url,
        chainId: rpc.chainId,
        symbol: 'ETH',
        apiUrl: 'https://explorer.example/api',
      });
      for (let i = 0; i < 8; ++i) await Promise.resolve();
      if (change === 'account')
        mockScope = { ...mockScope, account: 'account-b' };
      if (change === 'network')
        mockScope = { ...mockScope, network: 'network-b' };
      if (change === 'route')
        window.history.replaceState(
          { key: 'about-entry' },
          '',
          '/app.html#/settings/about'
        );
      if (change === 'native-key')
        window.history.replaceState(
          { key: 'another-rpc-entry' },
          '',
          '/app.html#/settings/networks/custom-rpc'
        );
      if (change === 'lock') mockStatus.isUnlocked = false;
      if (change === 'connection') mockStatus.connectionUnavailable = true;
      if (change === 'unmount') mockEffects[0]()();
      finish(
        stage === 'rpc' ? rpc : stage === 'api' ? { success: true } : undefined
      );
      await pending;
      const mayReturnAfterNetworkSave =
        stage === 'mutation' && change === 'network';
      expect(mockNavigateBack).toHaveBeenCalledTimes(
        mayReturnAfterNetworkSave ? 1 : 0
      );
      if (stage !== 'mutation')
        expect(mockEmitter).not.toHaveBeenCalledWith(
          ['wallet', 'addCustomRpc'],
          expect.anything()
        );
      expect(mockAlert.error).not.toHaveBeenCalled();
      expect(mockAlert.success).toHaveBeenCalledTimes(
        mayReturnAfterNetworkSave ? 1 : 0
      );
    }
  );

  it('returns a successful active-network API edit even though its network fingerprint changes', async () => {
    mockState.vaultGlobal.networks.ethereum[rpc.chainId] = rpc;
    mockLocation.state = {
      ...mockLocation.state,
      isEditing: true,
      selected: rpc,
    };
    mockEmitter.mockImplementation(async (method: string[]) => {
      if (method[1] === 'getRpc') return rpc;
      if (method[1] === 'editCustomRpc')
        mockScope = { ...mockScope, network: 'updated-api-fingerprint' };
      return undefined;
    });
    const view = render(CustomRPC);
    await find(
      view,
      (element) => typeof element.props.onFinish === 'function'
    )!.props.onFinish({
      label: 'Test',
      url: rpc.url,
      chainId: rpc.chainId,
      symbol: 'ETH',
      apiUrl: '',
    });
    expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed RPC add on its current page', async () => {
    mockEmitter.mockImplementation(async (method: string[]) => {
      if (method[1] === 'getRpc') return rpc;
      throw new Error('Could not save network');
    });
    await find(
      render(CustomRPC),
      (element) => typeof element.props.onFinish === 'function'
    )!.props.onFinish({
      label: 'Test',
      url: rpc.url,
      chainId: rpc.chainId,
      symbol: 'ETH',
    });
    expect(mockNavigateBack).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('leaves an edit route for a deleted network without restoring old URLs or API keys', () => {
    mockLocation.state = {
      isEditing: true,
      selected: {
        chainId: rpc.chainId,
        kind: INetworkType.Ethereum,
        url: 'https://deleted.example',
        apiUrl: 'https://deleted.example/?apikey=old-key',
      },
      returnContext: { returnRoute: '/settings/networks/edit' },
    };
    expect(render(CustomRPC)).toBeNull();
    mockEffects.forEach((effect) => effect());
    expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
    expect(mockForm.setFieldsValue).not.toHaveBeenCalled();
  });

  it('cancels Forget Wallet back to its origin without requesting secrets', () => {
    const view = render(ForgetWallet);
    find(
      view,
      (element) =>
        element.type === 'button' && element.props.children === 'buttons.cancel'
    )!.props.onClick();
    expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('restores a trusted-sites filter and replaces its own entry while keeping the caller', () => {
    mockLocation = {
      pathname: '/settings/networks/trusted-sites',
      search: '?view=list',
      hash: '#sites',
      state: {
        trustedSitesSearch: 'https://trusted',
        returnContext: { returnRoute: '/tokens/add' },
      },
    };
    const input = find(
      render(TrustedSites),
      (element) => element.type === 'input'
    )!;
    expect(input.props.value).toBe('https://trusted');
    input.props.onChange({ target: { value: 'https://other' } });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/settings/networks/trusted-sites?view=list#sites',
      {
        replace: true,
        state: {
          trustedSitesSearch: 'https://other',
          returnContext: mockLocation.state.returnContext,
        },
      }
    );
    expect(
      find(render(TrustedSites), (element) => element.type === 'input')!.props
        .value
    ).toBe('https://other');
  });

  it('restores account details from current wallet state using only id and type', () => {
    mockLocation = {
      pathname: '/settings/edit-account',
      search: '',
      hash: '',
      state: {
        id: 0,
        accountType: KeyringAccountType.HDAccount,
        address: 'stale-address',
        label: 'Old label',
      },
    };
    const view = render(EditAccount);
    expect(
      find(view, (element) => element.type === 'qr-code')!.props.value
    ).toBe('current-address');
    expect(
      find(view, (element) => typeof element.props.onFinish === 'function')!
        .props.initialValues
    ).toEqual({ label: 'Current label' });
  });

  it('leaves an edit route whose account no longer exists without rendering stale details', () => {
    mockLocation.state = {
      id: 99,
      accountType: KeyringAccountType.HDAccount,
      address: 'removed-address',
      returnContext: { returnRoute: '/settings/manage-accounts' },
    };
    expect(render(EditAccount)).toBeNull();
    mockEffects.forEach((effect) => effect());
    expect(mockNavigateBack).toHaveBeenCalledWith(mockNavigate, mockLocation);
    expect(mockEmitter).not.toHaveBeenCalled();
  });

  it('keeps the nested edit chain and URL when opening smart-account policy', () => {
    mockState.vault.accounts.SmartAccount = {
      2: {
        id: 2,
        label: 'Smart',
        address: 'smart-address',
        isSmartAccount: true,
      },
    };
    const parent = { returnRoute: '/settings/manage-accounts' };
    mockLocation = {
      pathname: '/settings/edit-account',
      search: '?view=account',
      hash: '#details',
      state: {
        id: 2,
        accountType: KeyringAccountType.SmartAccount,
        returnContext: parent,
      },
    };
    const view = render(EditAccount);
    find(
      view,
      (element) =>
        element.type === 'button' &&
        element.props.className?.includes('text-left')
    )!.props.onClick();
    expect(mockNavigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/settings/account/smart-account-policy',
      { id: 2, accountType: KeyringAccountType.SmartAccount },
      expect.objectContaining({
        returnRoute: '/settings/edit-account?view=account#details',
        returnContext: parent,
        state: { id: 2, accountType: KeyringAccountType.SmartAccount },
        walletScope: expect.objectContaining({
          account: expect.any(String),
          network: expect.any(String),
        }),
      })
    );
  });
});
