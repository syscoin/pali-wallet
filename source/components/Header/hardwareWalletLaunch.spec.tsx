import React from 'react';

import { ConnectHardwareWallet } from 'components/Modal/WarningBaseModal';

import { AccountMenu } from './AccountMenu';

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
  useController: () => ({ controllerEmitter: jest.fn() }),
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
  const url =
    'chrome-extension://pali/external.html?route=settings/account/hardware';

  beforeEach(() => {
    jest.useFakeTimers();
    global.chrome = {
      runtime: { getURL: jest.fn().mockReturnValue(url) },
      tabs: { create: jest.fn() },
      storage: { local: { set: jest.fn() } },
    } as unknown as typeof chrome;
  });
  afterEach(() => {
    global.chrome = originalChrome;
    jest.useRealTimers();
  });

  it('uses the extension tab API from the account menu', () => {
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
    button!.props.onClick();
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      { url },
      expect.any(Function)
    );
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'pali-popup-open': true }),
      expect.any(Function)
    );
  });

  it('uses the same extension tab API from the hardware warning dialog', () => {
    const onClose = jest.fn();
    const view = ConnectHardwareWallet({ title: 'Hardware', onClose });
    const button = findElement(
      view,
      (element) => element.props.id === 'hardware-connect-btn'
    );
    expect(button).toBeDefined();
    button!.props.onClick();
    expect(chrome.tabs.create).toHaveBeenCalledWith(
      { url },
      expect.any(Function)
    );
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
