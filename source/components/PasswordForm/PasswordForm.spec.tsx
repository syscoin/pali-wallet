/** @jest-environment jsdom */

import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { PasswordForm } from './PasswordForm';

let mockFinish: (values: any) => Promise<void>;
jest.mock('antd', () => {
  const Form: any = ({ onFinish, children }: any) => {
    mockFinish = onFinish;
    return <div>{children}</div>;
  };
  Form.Item = ({ children }: any) => <>{children}</>;
  Form.Item.displayName = 'MockFormItem';
  Form.useForm = () => [{ getFieldValue: () => '', validateFields: jest.fn() }];
  return { Form, Input: { Password: () => <input type="password" /> } };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/index', () => ({
  Button: ({ loading }: any) => (
    <button>{loading ? 'pending' : 'ready'}</button>
  ),
}));

it('handles a setup rejection and releases the loading state without displaying exception contents', async () => {
  const onSubmit = jest.fn().mockRejectedValue(new Error('secret fixture'));
  render(<PasswordForm onSubmit={onSubmit} />);
  await act(async () => {
    await mockFinish({ password: 'synthetic-password' });
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'settings.walletSetupFailed'
  );
  expect(screen.getByRole('button').textContent).toBe('ready');
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
  expect(screen.getByRole('button').textContent).toBe('pending');
  await act(async () => {
    resolve();
    await first;
  });
  expect(screen.getByRole('button').textContent).toBe('ready');
});
