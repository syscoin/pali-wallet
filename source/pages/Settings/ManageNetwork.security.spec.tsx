import React from 'react';

import { INetworkType } from 'types/network';

import ManageNetwork from './ManageNetwork';

let mockState: any;
let mockChanging = false;
let mockUnavailable = false;
let mockLocation: any;
const mockControllerEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockAlert = { error: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
    connectionUnavailable: mockUnavailable,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({ connectionUnavailable: mockUnavailable }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: mockChanging }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: 'span' }));
jest.mock('components/index', () => ({
  Button: 'button',
  IconButton: 'button',
  Icon: 'span',
  Tooltip: 'div',
  ConfirmationModal: 'confirmation-dialog',
}));
jest.mock('utils/index', () => ({ truncate: (value: string) => value }));
jest.mock('utils/navigationState', () => ({
  createBrowsingNavigationContext: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .createBrowsingNavigationContext(...args),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
  navigateBack: jest.fn(),
}));

const find = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = find(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

describe('network management transition safety', () => {
  let states: any[];
  let cursor: number;
  let effects: Array<() => any>;
  const render = () => {
    cursor = 0;
    effects = [];
    return ManageNetwork();
  };
  const dialog = () =>
    find(render(), (element) => element.type === 'confirmation-dialog')!;
  const openRemoval = () => {
    const button = find(
      render(),
      (element) =>
        element.type === 'button' &&
        Boolean(find(element, (child) => child.props.name === 'trash'))
    )!;
    button.props.onClick();
    return dialog();
  };
  beforeEach(() => {
    states = [];
    mockChanging = false;
    mockUnavailable = false;
    mockLocation = { pathname: '/settings/networks/edit', state: null };
    mockNavigateWithContext.mockReset();
    mockControllerEmitter.mockReset().mockResolvedValue(undefined);
    mockAlert.error.mockReset();
    mockState = {
      vault: { activeNetwork: { chainId: 57, url: 'https://active.example' } },
      vaultGlobal: {
        networkStatus: 'idle',
        isSwitchingAccount: false,
        networks: {
          ethereum: {},
          syscoin: {
            1: {
              chainId: 1,
              kind: INetworkType.Syscoin,
              label: 'Target',
              url: 'https://target.example',
              default: false,
            },
          },
        },
      },
    };
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        (value: any) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ] as any;
    });
    jest
      .spyOn(React, 'useRef')
      .mockImplementation((value) => ({ current: value }));
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      effects.push(effect);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps the original page and list position through editing a network', () => {
    const parent = { returnRoute: '/tokens/add', state: { tab: 'custom' } };
    mockLocation = {
      pathname: '/settings/networks/edit',
      search: '?family=utxo',
      hash: '#networks',
      state: { returnContext: parent },
    };
    mockState.vaultGlobal.networks.syscoin[1].apiUrl =
      'https://api.example/?apikey=private-key';
    const view = render();
    const list = find(view, (element) => element.type === 'ul')!;
    (list as any).ref.current = { scrollTop: 220 };
    find(
      view,
      (element) =>
        element.type === 'button' &&
        Boolean(find(element, (child) => child.props.name === 'edit'))
    )!.props.onClick();
    expect(mockNavigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/settings/networks/custom-rpc',
      {
        selected: { chainId: 1, key: undefined, kind: INetworkType.Syscoin },
        chain: INetworkType.Syscoin,
        isDefault: false,
        isEditing: true,
      },
      expect.objectContaining({
        returnRoute: '/settings/networks/edit?family=utxo#networks',
        returnContext: parent,
        state: { manageNetworksScrollTop: 220 },
        walletScope: expect.objectContaining({
          account: expect.any(String),
          network: expect.any(String),
        }),
      })
    );
  });

  it('restores the network list position separately from page scroll', () => {
    mockLocation.state = { manageNetworksScrollTop: 67, scrollPosition: 300 };
    const list = find(render(), (element) => element.type === 'ul')!;
    (list as any).ref.current = { scrollTop: 0 };
    effects.forEach((effect) => effect());
    expect((list as any).ref.current.scrollTop).toBe(67);
  });

  it('removes the selected network after a healthy confirmation', async () => {
    const confirmation = openRemoval();
    expect(confirmation.props.show).toBe(true);
    await confirmation.props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'removeKeyringNetwork'],
      [INetworkType.Syscoin, 1, 'https://target.example', 'Target', undefined]
    );
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  it('consumes a failed removal, clears its selection, and requires a fresh confirmation', async () => {
    mockControllerEmitter.mockRejectedValueOnce(
      new Error('internal storage details')
    );
    await expect(openRemoval().props.onClick()).resolves.toBeUndefined();
    expect(mockAlert.error).toHaveBeenCalledTimes(1);
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.networkRemovalIncomplete'
    );
    expect(dialog().props.show).toBe(false);
    await dialog().props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledTimes(1);

    mockState.vaultGlobal.networks.syscoin[1].url = 'https://updated.example';
    await openRemoval().props.onClick();
    expect(mockControllerEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'removeKeyringNetwork'],
      [INetworkType.Syscoin, 1, 'https://updated.example', 'Target', undefined]
    );
    expect(mockAlert.error).toHaveBeenCalledTimes(1);
  });

  it.each(['transition', 'disconnect'])(
    'hides the portal immediately during %s and clears it before recovery',
    (reason) => {
      expect(openRemoval().props.show).toBe(true);
      mockChanging = reason === 'transition';
      mockUnavailable = reason === 'disconnect';
      expect(dialog().props.show).toBe(false);
      effects.forEach((effect) => effect());
      mockChanging = false;
      mockUnavailable = false;
      expect(dialog().props.show).toBe(false);
      expect(mockControllerEmitter).not.toHaveBeenCalled();
    }
  );

  it.each(['switching', 'connecting', 'account', 'disconnect'])(
    'rejects an already-open confirmation when %s begins before React rerenders',
    async (state) => {
      const confirmation = openRemoval();
      if (state === 'account') mockState.vaultGlobal.isSwitchingAccount = true;
      else if (state === 'disconnect') mockUnavailable = true;
      else mockState.vaultGlobal.networkStatus = state;
      await confirmation.props.onClick();
      expect(mockControllerEmitter).not.toHaveBeenCalled();
      expect(dialog().props.show).toBe(false);
    }
  );

  it('does not open deletion while the context changes but keeps cancellation available', () => {
    mockChanging = true;
    expect(openRemoval().props.show).toBe(false);
    expect(() => dialog().props.onClose()).not.toThrow();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  });
});
