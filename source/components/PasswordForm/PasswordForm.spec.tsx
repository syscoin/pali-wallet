/** @jest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { generateMemorablePassword } from 'utils/memorablePassword';

import { PasswordForm } from './PasswordForm';

let mockFinish: (values: any) => Promise<void>;
let mockFields: Record<string, string>;
const mockForm = {
  getFieldValue: (name: string) => mockFields[name],
  setFieldsValue: jest.fn((values: Record<string, string>) =>
    Object.assign(mockFields, values)
  ),
  validateFields: jest.fn(),
};
jest.mock('antd', () => {
  const Form: any = ({ onFinish, children, autoComplete }: any) => {
    mockFinish = onFinish;
    return <form autoComplete={autoComplete}>{children}</form>;
  };
  Form.Item = ({ children }: any) => <>{children}</>;
  Form.Item.displayName = 'MockFormItem';
  Form.useForm = () => [mockForm];
  return {
    Form,
    Input: { Password: (props: any) => <input type="password" {...props} /> },
  };
});
jest.mock('utils/memorablePassword', () => ({
  generateMemorablePassword: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/index', () => ({
  Button: ({ loading, children, id, type, disabled, onClick }: any) => (
    <button id={id} type={type} disabled={disabled} onClick={onClick}>
      {loading
        ? 'pending'
        : id === 'create-password-action'
        ? 'ready'
        : children}
    </button>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFields = { password: '', repassword: '' };
  mockForm.validateFields.mockResolvedValue({});
  jest
    .mocked(generateMemorablePassword)
    .mockReturnValue(
      'Abandon-ability-able-about-above-absent-absorb-abstract-7'
    );
});

it('handles a setup rejection and releases the loading state without displaying exception contents', async () => {
  const onSubmit = jest.fn().mockRejectedValue(new Error('secret fixture'));
  render(<PasswordForm onSubmit={onSubmit} />);
  await act(async () => {
    await mockFinish({ password: 'synthetic-password' });
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'settings.walletSetupFailed'
  );
  expect(screen.getByRole('button', { name: 'ready' }).textContent).toBe(
    'ready'
  );
  expect(screen.queryByText('secret fixture')).toBeNull();
});

it('admits only one submission until the pending operation settles', async () => {
  let resolve: () => void;
  const onSubmit = jest
    .fn()
    .mockImplementation(() => new Promise<void>((done) => (resolve = done)));
  render(<PasswordForm onSubmit={onSubmit} />);
  let first: Promise<void>;
  act(() => {
    first = mockFinish({ password: 'synthetic-password' });
    void mockFinish({ password: 'synthetic-password' });
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'pending' }).textContent).toBe(
    'pending'
  );
  await act(async () => {
    resolve();
    await first;
  });
  expect(screen.getByRole('button', { name: 'ready' }).textContent).toBe(
    'ready'
  );
});

it('keeps a suggested password in the form and clears confirmation so it must be entered again', async () => {
  mockFields = { password: 'old-fixture', repassword: 'old-fixture' };
  mockForm.validateFields.mockRejectedValue({
    errorFields: [{ name: ['repassword'], errors: ['confirmation required'] }],
  });
  const onSubmit = jest.fn();
  render(<PasswordForm onSubmit={onSubmit} />);

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'components.suggestPassword' })
    );
  });

  expect(mockForm.setFieldsValue).toHaveBeenCalledWith({
    password: 'Abandon-ability-able-about-above-absent-absorb-abstract-7',
    repassword: '',
  });
  expect(mockFields.repassword).toBe('');
  expect(mockForm.validateFields).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'ready' }).hasAttribute('disabled')
  ).toBe(true);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('components.memorablePasswordHelp')).toBeTruthy();
});

it('reports generation failure without replacing the entered password or exposing exception contents', async () => {
  mockFields = { password: 'existing-fixture', repassword: 'existing-fixture' };
  jest.mocked(generateMemorablePassword).mockImplementation(() => {
    throw new Error('synthetic sensitive exception');
  });
  render(<PasswordForm onSubmit={jest.fn()} />);

  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'components.suggestPassword' })
    );
  });

  expect(screen.getByRole('alert').textContent).toBe(
    'components.passwordGenerationFailed'
  );
  expect(mockForm.setFieldsValue).not.toHaveBeenCalled();
  expect(mockFields.password).toBe('existing-fixture');
  expect(screen.queryByText('synthetic sensitive exception')).toBeNull();
});

it('supports password managers with distinct input IDs and new-password autocomplete', () => {
  render(<PasswordForm onSubmit={jest.fn()} />);
  const password = screen.getByPlaceholderText('components.newPassword');
  const confirmation = screen.getByPlaceholderText(
    'components.confirmPassword'
  );

  expect(password.getAttribute('autocomplete')).toBe('new-password');
  expect(confirmation.getAttribute('autocomplete')).toBe('new-password');
  expect(password.id).toBe('create-password');
  expect(confirmation.id).toBe('confirm-password');
  expect(password.closest('form').getAttribute('autocomplete')).toBe('on');
});

it('disables password generation while wallet creation is pending', async () => {
  let resolve: () => void;
  const onSubmit = jest.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      })
  );
  render(<PasswordForm onSubmit={onSubmit} />);
  let pending: Promise<void>;
  act(() => {
    pending = mockFinish({ password: 'synthetic-password' });
  });

  const suggestion = screen.getByRole('button', {
    name: 'components.suggestPassword',
  });
  expect(suggestion.hasAttribute('disabled')).toBe(true);
  fireEvent.click(suggestion);
  expect(generateMemorablePassword).not.toHaveBeenCalled();
  await act(async () => {
    resolve();
    await pending;
  });
});
