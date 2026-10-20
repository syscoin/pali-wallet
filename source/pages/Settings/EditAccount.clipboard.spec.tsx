/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import EditAccount from './EditAccount';

const mockWrite = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const mockAddress = 'tsys1qsyntheticpublicaccountaddress';
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        accounts: {
          HDAccount: {
            0: { id: 0, label: 'QA account', address: mockAddress },
          },
        },
      },
    }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/settings/edit-account',
    state: { id: 0, accountType: 'HDAccount' },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('hooks/useUtils').useUtils,
}));
jest.mock('hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.fn(),
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    error: (...args: any[]) => mockAlert.error(...args),
    success: (...args: any[]) => mockAlert.success(...args),
    dismiss: jest.fn(),
  }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'transactions.copyFailed' },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg /> }));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({ account: 'account', network: 'network' }),
  navigateBack: jest.fn(),
}));
jest.mock('utils/format', () => ({ ellipsis: (value: string) => value }));
jest.mock('antd/lib/form/Form', () => ({ useForm: () => [{}] }));
jest.mock('antd', () => {
  const Form: any = ({ children }: any) => <form>{children}</form>;
  Form.Item = ({ children }: any) => children;
  Form.Item.displayName = 'MockFormItem';
  return { Form, Input: (props: any) => <input {...props} /> };
});
jest.mock('components/Icon/Icon', () => ({ LockIconSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children }: any) => <footer>{children}</footer>,
  Button: ({ children, type, onClick }: any) => (
    <button type={type} onClick={onClick}>
      {children}
    </button>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
});

it('copies only the selected account public address', async () => {
  render(<EditAccount />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  await waitFor(() => expect(mockWrite).toHaveBeenCalledWith(mockAddress));
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('reports public-address clipboard refusal without claiming success', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Synthetic clipboard refusal'));
  render(<EditAccount />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed')
  );
  expect(mockAlert.error).toHaveBeenCalledTimes(1);
  expect(mockAlert.success).not.toHaveBeenCalled();
});
