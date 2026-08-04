import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  formatApprovalTokenAmount,
  getApprovalAddressValues,
} from '../approval';
import { Interface } from 'utils/ethersV6Compat';
import { decodeTransactionData } from 'utils/ethUtil';
import * as validations from 'utils/validations';

import { ApprovalDetails } from './ApprovalDetails';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('components/AddressText', () => ({
  AddressText: ({ value }: { value: string }) => (
    <span data-address={value}>{value}</span>
  ),
}));

const AUTHORITY = '0x1111111111111111111111111111111111111111';
const TOKEN_CONTRACT = '0x2222222222222222222222222222222222222222';
const APPROVAL_INTERFACE = new Interface([
  'function approve(address spender,uint256 amount)',
  'function increaseAllowance(address spender,uint256 addedValue)',
  'function decreaseAllowance(address spender,uint256 subtractedValue)',
  'function setApprovalForAll(address operator,bool approved)',
]);

const decodeApproval = async (
  method: string,
  value: string | number | boolean,
  contractType: string
) => {
  jest
    .spyOn(validations, 'getContractType')
    .mockResolvedValue({ type: contractType });

  return (await decodeTransactionData(
    {
      data: APPROVAL_INTERFACE.encodeFunctionData(method, [AUTHORITY, value]),
      to: TOKEN_CONTRACT,
    } as any,
    {}
  )) as any;
};

describe('ApprovalDetails', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('binds real ERC-20 approve calldata to the spender row', async () => {
    const decodedTx = await decodeApproval(
      'approve',
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'ERC-20'
    );
    const values = getApprovalAddressValues(
      decodedTx,
      TOKEN_CONTRACT,
      decodedTx.approvalType
    );
    const markup = renderToStaticMarkup(
      <ApprovalDetails {...values} formattedAmount="0" isUnlimited />
    );

    expect(decodedTx.method).toBe('approve');
    expect(decodedTx.inputs[0]).toBe(AUTHORITY);
    expect(values.isValid).toBe(true);
    expect(markup).toContain('transactions.spender');
    expect(markup).toContain(`data-address="${AUTHORITY}"`);
    expect(markup).toContain('settings.contractAddress');
    expect(markup).toContain(`data-address="${TOKEN_CONTRACT}"`);
    expect(markup).toContain('transactions.unlimited');
  });

  it.each(['increaseAllowance', 'decreaseAllowance'])(
    'binds real %s calldata to the spender and amount rows',
    async (method) => {
      const decodedTx = await decodeApproval(method, 1_500_000, 'ERC-20');
      const values = getApprovalAddressValues(
        decodedTx,
        TOKEN_CONTRACT,
        decodedTx.approvalType
      );
      const markup = renderToStaticMarkup(
        <ApprovalDetails
          {...values}
          formattedAmount={formatApprovalTokenAmount(decodedTx.inputs[1], 6)}
          tokenSymbol="TEST"
        />
      );

      expect(values.isValid).toBe(true);
      expect(markup).toContain('transactions.spender');
      expect(markup).toContain(`transactions.methodNames.${method}`);
      expect(markup).toContain('1.5 TEST');
    }
  );

  it('shows the approved address for ERC-721 approve calldata', async () => {
    const decodedTx = await decodeApproval('approve', 7, 'ERC-721');
    const values = getApprovalAddressValues(
      decodedTx,
      TOKEN_CONTRACT,
      decodedTx.approvalType
    );
    const markup = renderToStaticMarkup(<ApprovalDetails {...values} />);

    expect(values.isValid).toBe(true);
    expect(markup).toContain('transactions.approvedTo');
    expect(markup).toContain(`data-address="${AUTHORITY}"`);
    expect(markup).not.toContain('transactions.spender');
  });

  it('uses the full address component for setApprovalForAll operators', async () => {
    const decodedTx = await decodeApproval(
      'setApprovalForAll',
      true,
      'ERC-721'
    );
    const values = getApprovalAddressValues(
      decodedTx,
      TOKEN_CONTRACT,
      decodedTx.approvalType
    );
    const markup = renderToStaticMarkup(<ApprovalDetails {...values} />);

    expect(values.isValid).toBe(true);
    expect(markup).toContain('transactions.operator');
    expect(markup).toContain(`data-address="${AUTHORITY}"`);
  });

  it('fails closed when the decoded authority is missing', () => {
    const values = getApprovalAddressValues(
      { inputs: [], method: 'approve' },
      TOKEN_CONTRACT,
      'erc20-amount'
    );
    const markup = renderToStaticMarkup(<ApprovalDetails {...values} />);

    expect(values.isValid).toBe(false);
    expect(markup).toContain('send.invalidApprovalDetails');
    expect(markup).not.toContain('settings.contractAddress');
  });
});
