import React from 'react';

import { ChangeConnectedAccount } from './ChangeConnectedAccount';

const ADDRESS_A = `0x${'1'.repeat(40)}`;
const ADDRESS_B = `0x${'2'.repeat(40)}`;
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
const mockEmitter = jest.fn();

jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { id: 1, type: 'HDAccount' },
        accounts: {
          HDAccount: {
            1: { id: 1, address: ADDRESS_B, label: 'Active account' },
          },
        },
        isBitcoinBased: false,
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
  useQueryData: () => ({
    host: 'fixture.invalid',
    eventName: 'changeConnectedAccount',
    accountType: 'HDAccount',
    connectedAccount: { id: 0, address: ADDRESS_A, label: 'Connected account' },
  }),
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountRef: (state: any) => state.vault.activeAccount,
  selectActiveAccount: (state: any) => state.vault.accounts.HDAccount[1],
  selectAccountAssets: () => ({}),
}));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: 'account-balance',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: 'token-icon' }));
jest.mock('components/index', () => ({
  Button: 'button',
  Icon: 'icon',
  PageActionFooter: 'footer',
  Tooltip: 'tooltip',
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const elements = (node: React.ReactNode): React.ReactElement[] =>
  React.Children.toArray(node).flatMap((child) =>
    React.isValidElement(child)
      ? [child, ...elements(child.props.children)]
      : []
  );
const copyActions = () =>
  elements(ChangeConnectedAccount()).filter(
    (element) =>
      element.type === 'button' &&
      elements(element).some((child) => child.props.name === 'copy')
  );

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(React, 'useState')
    .mockImplementation((value?: any) => [value, jest.fn()] as any);
  jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
  mockCopy.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each([
  [0, ADDRESS_A],
  [1, ADDRESS_B],
])(
  'waits for public address copy %s before announcing success',
  async (index, address) => {
    let complete!: () => void;
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve) => (complete = resolve))
    );
    const request = copyActions()[index as number].props.onClick();
    expect(mockCopy).toHaveBeenCalledWith(address);
    expect(mockAlert.info).not.toHaveBeenCalled();
    complete();
    await request;
    expect(mockAlert.info).toHaveBeenCalledWith('home.addressCopied');
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it.each([0, 1])(
  'handles public address copy %s refusal without success',
  async (index) => {
    const failure = Promise.reject(new Error('Synthetic clipboard refusal'));
    void failure.catch(() => undefined);
    mockCopy.mockReturnValueOnce(failure);
    await copyActions()[index].props.onClick();
    expect(mockAlert.info).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed');
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);
