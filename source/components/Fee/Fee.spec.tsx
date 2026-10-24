/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Fee } from './Fee';

let mockFiatAvailable = true;
const mockGetFiatAmount = jest.fn<string, [number, number?, string?]>(() => '');
let mockValidate: (_: unknown, value: unknown) => Promise<void>;
const mockState = {
  vault: { isBitcoinBased: true, activeNetwork: { currency: 'SYS' } },
  price: { fiat: { asset: 'USD' } },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
const mockTranslation = jest.fn((key: string) => key);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslation }),
}));
jest.mock('hooks/index', () => ({
  usePrice: () => ({
    getFiatAmount: mockGetFiatAmount,
    isFiatAvailable: mockFiatAvailable,
  }),
}));
jest.mock('..', () => ({
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('antd', () => ({
  Form: {
    Item: ({ children, rules }: any) => {
      mockValidate = rules.find((rule: any) => typeof rule === 'function')()
        .validator;
      return <>{children}</>;
    },
  },
  Input: ({ suffix, ...props }: any) => (
    <>
      {suffix}
      <input {...props} />
    </>
  ),
}));

describe('fee-rate submission validity', () => {
  const form = {
    getFieldValue: () => '0.00000001',
    setFieldsValue: jest.fn(),
    validateFields: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    mockState.vault.isBitcoinBased = true;
    mockFiatAvailable = true;
    mockGetFiatAmount.mockReset().mockReturnValue('');
    form.validateFields.mockReset().mockResolvedValue(undefined);
    mockTranslation.mockClear();
  });

  it.each(['-1', '-0.00000001', '0', 0, '', ' ', 'Infinity', '0.00000001junk'])(
    'rejects non-positive or non-finite fee rate %s',
    async (value) => {
      render(<Fee disabled={false} form={form} />);
      await expect(mockValidate(undefined, value)).rejects.toBeDefined();
    }
  );

  it('accepts a finite positive fee rate', async () => {
    render(<Fee disabled={false} form={form} />);
    await expect(
      mockValidate(undefined, '0.00000001')
    ).resolves.toBeUndefined();
  });

  it.each(['0.00005', '0.0001', '0.001', '0.1', '1'])(
    'rejects a UTXO rate at or above the signed extraction safety limit: %s',
    async (value) => {
      render(<Fee disabled={false} form={form} />);
      await expect(mockValidate(undefined, value)).rejects.toBe('');
      expect(mockTranslation).toHaveBeenCalledWith(
        'send.feeRateSafetyLimit',
        expect.objectContaining({ currency: 'SYS', limit: '0.00005000' })
      );
    }
  );

  it.each(['0.00001', '0.00004999'])(
    'warns but allows the sub-limit rate %s in coin/vbyte',
    async (value) => {
      render(<Fee disabled={false} form={form} />);
      await expect(mockValidate(undefined, value)).resolves.toBeUndefined();
      expect(mockTranslation).toHaveBeenCalledWith(
        'send.feeRateNormal',
        expect.objectContaining({ currency: 'SYS' })
      );
    }
  );

  it('shows the coin/vbyte unit even after a rate is entered', () => {
    render(<Fee disabled={false} form={form} />);
    expect(
      (screen.getByLabelText('components.feeRateLabel') as HTMLInputElement)
        .value
    ).toBe('0.00000001');
  });

  it('renders small recommended numeric rates without exponent notation', () => {
    const localForm = {
      ...form,
      getFieldValue: () => 1.25390625e-8,
    };
    render(<Fee disabled={false} form={localForm} recommend={1.25390625e-8} />);
    expect(screen.getByRole('spinbutton').getAttribute('value')).toBe(
      '0.0000000125390625'
    );
  });

  it('does not apply the UTXO safety threshold to EVM gas prices', async () => {
    mockState.vault.isBitcoinBased = false;
    render(<Fee disabled={false} form={form} />);
    await expect(mockValidate(undefined, '1')).resolves.toBeUndefined();
  });

  it('rejects non-finite values when the field represents an EVM gas price', async () => {
    mockState.vault.isBitcoinBased = false;
    render(<Fee disabled={false} form={form} />);
    await expect(mockValidate(undefined, 'Infinity')).rejects.toBeDefined();
  });

  it('does not notify the parent of an invalid edit or leak a validation rejection', async () => {
    const onFeeChange = jest.fn();
    form.validateFields.mockRejectedValue(new Error('Invalid fee'));
    render(<Fee disabled={false} form={form} onFeeChange={onFeeChange} />);
    onFeeChange.mockClear();
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '-1' },
    });
    await Promise.resolve();
    expect(onFeeChange).not.toHaveBeenCalled();
    expect(form.validateFields).toHaveBeenCalledWith(['fee']);
  });
  it('suppresses an unavailable fiat estimate while retaining the exact fee and validation', async () => {
    mockFiatAvailable = false;
    mockGetFiatAmount.mockReturnValue('0 USD');
    const view = render(<Fee disabled={false} form={form} />);
    expect(screen.queryByText(/0 USD/)).toBeNull();
    expect(mockGetFiatAmount).not.toHaveBeenCalled();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe(
      '0.00000001'
    );
    await expect(mockValidate(undefined, '0.00005')).rejects.toBe('');
    mockFiatAvailable = true;
    view.rerender(<Fee disabled={false} form={form} />);
    expect(screen.getByText(/0 USD/)).toBeTruthy();
    expect(mockGetFiatAmount.mock.calls[0][0]).toBeCloseTo(0.000003, 12);
    mockGetFiatAmount.mockReturnValue('-0.1 USD');
    view.rerender(<Fee disabled={false} form={form} />);
    expect(screen.getByText(/-0.1 USD/)).toBeTruthy();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe(
      '0.00000001'
    );
  });
});
