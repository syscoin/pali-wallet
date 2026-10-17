/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { AddressText } from './AddressText';

const mockCopy = jest.fn();
const mockInfo = jest.fn();
const mockError = jest.fn();
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, mockCopy],
    alert: { info: mockInfo, error: mockError },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon', () => ({ Icon: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
});

it.each(['resolve', 'reject'])(
  'announces only the settled clipboard result: %s',
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    mockCopy.mockReturnValue(
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      })
    );
    render(<AddressText value="0x1111111111111111111111111111111111111111" />);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    await act(async () => {
      if (outcome === 'resolve') resolve();
      else reject(new Error('Synthetic clipboard denial'));
    });
    if (outcome === 'resolve') {
      expect(mockInfo).toHaveBeenCalledWith('home.addressCopied');
      expect(mockError).not.toHaveBeenCalled();
    } else {
      expect(mockInfo).not.toHaveBeenCalled();
      expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
    }
  }
);
