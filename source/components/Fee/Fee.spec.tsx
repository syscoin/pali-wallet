/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { Fee } from './Fee';

let mockValidate: (_: unknown, value: unknown) => Promise<void>;
const mockState = {
  vault: { isBitcoinBased: true, activeNetwork: { currency: 'SYS' } },
  price: { fiat: { asset: 'USD' } },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  usePrice: () => ({ getFiatAmount: () => '' }),
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
    form.validateFields.mockReset().mockResolvedValue(undefined);
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

  it('still rejects the existing excessive UTXO fee bound', async () => {
    render(<Fee disabled={false} form={form} />);
    await expect(mockValidate(undefined, '0.1')).rejects.toBe('');
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
});
