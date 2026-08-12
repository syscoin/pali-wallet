import { defaultAbiCoder, hexConcat, id } from 'utils/ethersV6Compat';

import {
  findEvmAddressPoisoningCollision,
  getEvmHistoryAddressCopyRisk,
  getTrustedEvmRecipients,
} from './addressPoisoning';
import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmNonce';

const ACTIVE_ACCOUNT = '0x1111111111111111111111111111111111111111';
const LEGITIMATE_RECIPIENT = '0x6d90cc8ce83b6d0acf634ed45d4bcc37eddd2e48';
const POISONED_RECIPIENT = '0x6d9052b2df589de00324127fe2707eb34e592e48';
const UNRELATED_RECIPIENT = '0x2222222222222222222222222222222222222222';
const TOKEN_CONTRACT = '0x5555555555555555555555555555555555555555';
const ENTRYPOINT = '0x433709009b8330fda32311df1c2afa402ed8d009';
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

const encodeTransfer = (recipient: string, value = 1) =>
  `${id('transfer(address,uint256)').slice(0, 10)}${defaultAbiCoder
    .encode(['address', 'uint256'], [recipient, value])
    .slice(2)}`;

const encodeTransferFrom = (from: string, recipient: string, value = 0) =>
  `${id('transferFrom(address,address,uint256)').slice(0, 10)}${defaultAbiCoder
    .encode(['address', 'address', 'uint256'], [from, recipient, value])
    .slice(2)}`;

const encodeSmartAccountNativeTransfer = (recipient: string) => {
  const executionCalldata = hexConcat([
    recipient,
    defaultAbiCoder.encode(['uint256'], ['1']),
  ]);
  const executeCall = `${id('execute(bytes32,bytes)').slice(
    0,
    10
  )}${defaultAbiCoder
    .encode(['bytes32', 'bytes'], [ZERO_BYTES32, executionCalldata])
    .slice(2)}`;
  const userOperation = [
    ACTIVE_ACCOUNT,
    0,
    '0x',
    executeCall,
    ZERO_BYTES32,
    50_000,
    ZERO_BYTES32,
    '0x',
    '0x1234',
  ];

  return `${id(
    'handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)'
  ).slice(0, 10)}${defaultAbiCoder
    .encode(
      [
        'tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[]',
        'address',
      ],
      [[userOperation], UNRELATED_RECIPIENT]
    )
    .slice(2)}`;
};

describe('EVM address poisoning protection', () => {
  it('trusts recipients from canonical outbound native and token transactions', () => {
    expect(
      getTrustedEvmRecipients(
        [
          {
            from: ACTIVE_ACCOUNT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            input: '0x',
            to: LEGITIMATE_RECIPIENT,
            ['txreceipt_status']: '1',
          },
          {
            from: ACTIVE_ACCOUNT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            input: encodeTransfer(UNRELATED_RECIPIENT),
            to: TOKEN_CONTRACT,
            ['txreceipt_status']: '1',
          },
        ],
        ACTIVE_ACCOUNT
      )
    ).toEqual([LEGITIMATE_RECIPIENT, UNRELATED_RECIPIENT]);
  });

  it('preserves smart-account outbound recipients as trusted history', () => {
    expect(
      getTrustedEvmRecipients(
        [
          {
            from: UNRELATED_RECIPIENT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            input: encodeSmartAccountNativeTransfer(LEGITIMATE_RECIPIENT),
            smartAccountExecutionFrom: ACTIVE_ACCOUNT,
            to: ENTRYPOINT,
            ['txreceipt_status']: '1',
          },
        ],
        ACTIVE_ACCOUNT
      )
    ).toEqual([LEGITIMATE_RECIPIENT]);
  });

  it('does not trust inbound transfers or synthetic token-event history', () => {
    expect(
      getTrustedEvmRecipients(
        [
          {
            from: POISONED_RECIPIENT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            input: '0x',
            to: ACTIVE_ACCOUNT,
            ['txreceipt_status']: '1',
          },
          {
            from: ACTIVE_ACCOUNT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
            input: encodeTransferFrom(ACTIVE_ACCOUNT, POISONED_RECIPIENT),
            to: TOKEN_CONTRACT,
            tokenRecipient: POISONED_RECIPIENT,
            ['txreceipt_status']: '1',
          },
        ],
        ACTIVE_ACCOUNT
      )
    ).toEqual([]);
  });

  it('does not trust failed outbound transactions', () => {
    expect(
      getTrustedEvmRecipients(
        [
          {
            from: ACTIVE_ACCOUNT,
            historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
            input: '0x',
            to: LEGITIMATE_RECIPIENT,
            ['txreceipt_status']: '0',
          },
        ],
        ACTIVE_ACCOUNT
      )
    ).toEqual([]);
  });

  it('detects the linked first-four/last-four lookalike without blocking exact or unrelated addresses', () => {
    expect(
      findEvmAddressPoisoningCollision(POISONED_RECIPIENT, [
        LEGITIMATE_RECIPIENT,
      ])
    ).toMatchObject({
      candidate: POISONED_RECIPIENT,
      trustedAddress: LEGITIMATE_RECIPIENT,
    });
    expect(
      findEvmAddressPoisoningCollision(LEGITIMATE_RECIPIENT, [
        LEGITIMATE_RECIPIENT,
      ])
    ).toBeNull();
    expect(
      findEvmAddressPoisoningCollision(UNRELATED_RECIPIENT, [
        LEGITIMATE_RECIPIENT,
      ])
    ).toBeNull();
    expect(
      findEvmAddressPoisoningCollision(
        POISONED_RECIPIENT,
        [LEGITIMATE_RECIPIENT],
        [POISONED_RECIPIENT]
      )
    ).toBeNull();
  });

  it('refuses copying untrusted history addresses but preserves canonical outbound copies', () => {
    const trustedRecipients = [LEGITIMATE_RECIPIENT];
    expect(
      getEvmHistoryAddressCopyRisk({
        accountAddress: ACTIVE_ACCOUNT,
        address: POISONED_RECIPIENT,
        label: 'From',
        transaction: {
          direction: 'received',
          from: POISONED_RECIPIENT,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
          to: ACTIVE_ACCOUNT,
        },
        trustedRecipients,
      })
    ).toMatchObject({
      kind: 'lookalike',
      trustedAddress: LEGITIMATE_RECIPIENT,
    });

    expect(
      getEvmHistoryAddressCopyRisk({
        accountAddress: ACTIVE_ACCOUNT,
        address: UNRELATED_RECIPIENT,
        label: 'From',
        transaction: {
          direction: 'received',
          from: UNRELATED_RECIPIENT,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
          to: ACTIVE_ACCOUNT,
        },
        trustedRecipients,
      })
    ).toMatchObject({ kind: 'untrusted-history' });

    expect(
      getEvmHistoryAddressCopyRisk({
        accountAddress: ACTIVE_ACCOUNT,
        address: POISONED_RECIPIENT,
        label: 'To',
        transaction: {
          from: ACTIVE_ACCOUNT,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer,
          to: TOKEN_CONTRACT,
          tokenRecipient: POISONED_RECIPIENT,
        },
        trustedRecipients: [],
      })
    ).toMatchObject({ kind: 'untrusted-history' });

    expect(
      getEvmHistoryAddressCopyRisk({
        accountAddress: ACTIVE_ACCOUNT,
        address: LEGITIMATE_RECIPIENT,
        label: 'To',
        transaction: {
          direction: 'sent',
          from: ACTIVE_ACCOUNT,
          historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
          to: LEGITIMATE_RECIPIENT,
        },
        trustedRecipients,
      })
    ).toBeNull();
  });
});
