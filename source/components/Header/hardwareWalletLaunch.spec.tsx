import React from 'react';

import { ConnectHardwareWallet } from 'components/Modal/WarningBaseModal';

import { AccountMenu } from './AccountMenu';

const mockControllerEmitter = jest.fn();

jest.mock('@headlessui/react', () => ({ Menu: { Item: 'menu-item' } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { activeAccount: { id: 0, type: 'HDAccount' } } }),
}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockControllerEmitter }),
}));
jest.mock('utils/navigationState', () => ({}));
jest.mock('components/Icon/Icon', () => ({
  AddUserSvg: 'span',
  ManageUserSvg: 'span',
  KeySvg: 'span',
  HardWalletIconSvg: 'span',
  UserImportedIconSvg: 'span',
}));
jest.mock('components/Dialog/Dialog', () => ({
  DialogPrimitive: 'dialog',
  SheetHeader: 'header',
  SheetPanel: 'section',
}));
jest.mock('components/index', () => ({ Button: 'button' }));
jest.mock('./RenderAccountsListByBitcoinBased', () => ({
  __esModule: true,
  default: 'account-list',
}));

const findElement = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = findElement(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

describe('hardware setup extension tab launch', () => {
  const originalChrome = global.chrome;
  const originalWindow = global.window;
  const url =
    'chrome-extension://pali/external.html?route=settings/account/hardware';

  beforeEach(() => {
    jest.useFakeTimers();
    mockControllerEmitter.mockReset().mockResolvedValue(undefined);
    global.window = { close: jest.fn() } as unknown as Window &
      typeof globalThis;
    global.chrome = {
      runtime: { getURL: jest.fn().mockReturnValue(url) },
      tabs: { create: jest.fn() },
      storage: { local: { set: jest.fn() } },
    } as unknown as typeof chrome;
  });
  afterEach(() => {
    global.chrome = originalChrome;
    global.window = originalWindow;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('uses the serialized background creation method from the account menu', async () => {
    const button = findElement(
      AccountMenu({}),
      (element) =>
        element.type === 'li' &&
        Boolean(
          findElement(
            element,
            (child) => child.props.children === 'accountMenu.connectTrezor'
          )
        )
    );
    expect(button).toBeDefined();
    await button!.props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledWith(
      ['createHardwareWalletTab'],
      [],
      10000,
      false
    );
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('closes the hardware warning only after background creation succeeds', async () => {
    const onClose = jest.fn();
    const view = ConnectHardwareWallet({ title: 'Hardware', onClose });
    const button = findElement(
      view,
      (element) => element.props.id === 'hardware-connect-btn'
    );
    expect(button).toBeDefined();
    await button!.props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledWith(
      ['createHardwareWalletTab'],
      [],
      10000,
      false
    );
    expect(onClose).toHaveBeenCalledWith(true);
    expect(window.close).toHaveBeenCalled();
  });

  it('keeps the warning open when another external view blocks creation', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockControllerEmitter.mockRejectedValue(new Error('View already open'));
    const onClose = jest.fn();
    const view = ConnectHardwareWallet({ title: 'Hardware', onClose });
    const button = findElement(
      view,
      (element) => element.props.id === 'hardware-connect-btn'
    );
    await button!.props.onClick();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });
});
