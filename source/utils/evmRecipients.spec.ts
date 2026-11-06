import { smartAccountAddressFixture } from '../../tests/fixtures/smartAccountAddress';
import {
  IKeyringAccountState,
  INetwork,
  INetworkType,
  ISmartAccountMetadata,
  KeyringAccountType,
  initialActiveHdAccountState,
} from 'types/network';

import { getLocalEvmRecipients } from './evmRecipients';

const ADDRESS = '0x940000000000000000000000000000000000a52e';
const OTHER_ADDRESS = '0x670000000000000000000000000000000000bfbb';
const nevmNetwork = {
  chainId: 5700,
  kind: INetworkType.Ethereum,
  slip44: 60,
  url: 'https://rpc.tanenbaum.io',
} as INetwork;
const zkNetwork = {
  ...nevmNetwork,
  chainId: 57057,
  url: 'https://rpc-zk.tanenbaum.io',
};
const makeAccount = (
  address = ADDRESS,
  metadata?: ISmartAccountMetadata,
  id = 0
): IKeyringAccountState => ({
  ...initialActiveHdAccountState,
  address,
  id,
  isSmartAccount: Boolean(metadata),
  smartAccount: metadata,
});
const smartMetadata = (chainId: number): ISmartAccountMetadata => ({
  chainId,
  contractVersion: '1',
  deploymentSalt: '0x01',
  isDeployed: false,
});

const makeSmartAccount = (chainId: number, id = 0): IKeyringAccountState => ({
  ...initialActiveHdAccountState,
  ...smartAccountAddressFixture(chainId).account,
  id,
  isSmartAccount: true,
});

describe('getLocalEvmRecipients', () => {
  it('excludes and blocks a smart account from another chain', () => {
    const smart = makeSmartAccount(zkNetwork.chainId);
    const result = getLocalEvmRecipients(
      { SmartAccount: { 0: smart } },
      nevmNetwork
    );

    expect(result.accounts).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.incompatibleSmartAddresses).toEqual(
      new Set([smart.address.toLowerCase()])
    );
    expect(result.getRecipientIssue(smart.address)).toBe(
      'send.smartAccountWrongNetwork'
    );
  });

  it('permits funding an undeployed smart account on its own chain', () => {
    const smart = makeSmartAccount(zkNetwork.chainId);
    const result = getLocalEvmRecipients(
      { SmartAccount: { 0: smart } },
      zkNetwork
    );

    expect(smart.smartAccount?.isDeployed).toBe(false);
    expect(smart.balances.ethereum).toBe(0);
    expect(result.accounts).toEqual([smart]);
    expect(result.addresses).toEqual([smart.address.toLowerCase()]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it('blocks a same-chain recipient with a mismatched counterfactual address', () => {
    const smart = {
      ...makeSmartAccount(zkNetwork.chainId),
      address: ADDRESS,
      xpub: ADDRESS,
    };
    const result = getLocalEvmRecipients(
      { SmartAccount: { 0: smart } },
      zkNetwork
    );

    expect(result.accounts).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
    expect(result.getRecipientIssue(ADDRESS)).toBe(
      'receive.addressUnavailable'
    );
  });

  it('retains compatibility when the same chain uses another RPC URL', () => {
    const smart = makeSmartAccount(zkNetwork.chainId);
    const result = getLocalEvmRecipients(
      { SmartAccount: { 0: smart } },
      { ...zkNetwork, url: 'https://another-rpc.example' }
    );

    expect(result.accounts).toEqual([smart]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it.each([
    KeyringAccountType.HDAccount,
    KeyringAccountType.Imported,
    KeyringAccountType.Ledger,
    KeyringAccountType.Trezor,
  ])('keeps %s EOA recipients portable across EVM chains', (type) => {
    const account = makeAccount();
    const result = getLocalEvmRecipients({ [type]: { 0: account } }, zkNetwork);

    expect(result.accounts).toEqual([account]);
    expect(result.addresses).toEqual([ADDRESS]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it.each([
    KeyringAccountType.HDAccount,
    KeyringAccountType.Imported,
    KeyringAccountType.Ledger,
    KeyringAccountType.Trezor,
    KeyringAccountType.SmartAccount,
  ])('permits an address also owned by a compatible %s account', (type) => {
    const compatible =
      type === KeyringAccountType.SmartAccount
        ? makeSmartAccount(nevmNetwork.chainId, 1)
        : makeAccount(ADDRESS, undefined, 1);
    const wrongChain = makeAccount(
      compatible.address,
      smartMetadata(zkNetwork.chainId)
    );
    const accountBuckets =
      type === KeyringAccountType.SmartAccount
        ? { SmartAccount: { 0: wrongChain, 1: compatible } }
        : { SmartAccount: { 0: wrongChain }, [type]: { 1: compatible } };
    const result = getLocalEvmRecipients(accountBuckets, nevmNetwork);

    expect(result.accounts).toEqual([compatible]);
    expect(result.addresses).toEqual([compatible.address.toLowerCase()]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it('removes a block even when the compatible account is visited first', () => {
    const compatible = makeAccount();
    const result = getLocalEvmRecipients(
      {
        HDAccount: { 0: compatible },
        SmartAccount: {
          0: makeAccount(ADDRESS, smartMetadata(zkNetwork.chainId)),
        },
      },
      nevmNetwork
    );

    expect(result.accounts).toEqual([compatible]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it.each([undefined, {} as ISmartAccountMetadata])(
    'fails closed for a smart-account bucket missing chain metadata: %s',
    (metadata) => {
      const result = getLocalEvmRecipients(
        { SmartAccount: { 0: makeAccount(ADDRESS, metadata) } },
        nevmNetwork
      );

      expect(result.accounts).toEqual([]);
      expect(result.incompatibleSmartAddresses).toEqual(new Set([ADDRESS]));
    }
  );

  it('matches addresses case-insensitively and de-duplicates trusted addresses', () => {
    const uppercase = `0x${ADDRESS.slice(2).toUpperCase()}`;
    const compatible = makeAccount(uppercase);
    const duplicate = makeAccount(ADDRESS, undefined, 1);
    const result = getLocalEvmRecipients(
      {
        HDAccount: { 0: compatible, 1: duplicate },
        SmartAccount: {
          0: makeAccount(uppercase, smartMetadata(zkNetwork.chainId)),
          1: makeAccount(
            OTHER_ADDRESS.toUpperCase(),
            smartMetadata(zkNetwork.chainId),
            1
          ),
        },
      },
      nevmNetwork
    );

    expect(result.accounts).toEqual([compatible, duplicate]);
    expect(result.addresses).toEqual([ADDRESS]);
    expect(result.incompatibleSmartAddresses).toEqual(new Set([OTHER_ADDRESS]));
  });

  it('rejects malformed addresses and never promotes UTXO accounts', () => {
    const result = getLocalEvmRecipients(
      {
        HDAccount: {
          0: makeAccount('tsys1qexampleaddress'),
          1: makeAccount('0x12', undefined, 1),
          2: makeAccount(`0x${'g'.repeat(40)}`, undefined, 2),
        },
        SmartAccount: {
          0: makeAccount('0x12', smartMetadata(zkNetwork.chainId)),
        },
      },
      nevmNetwork
    );

    expect(result.accounts).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.incompatibleSmartAddresses.size).toBe(0);
  });

  it('does not expose EVM recipients on a UTXO network', () => {
    const result = getLocalEvmRecipients(
      {
        HDAccount: { 0: makeAccount() },
        SmartAccount: {
          0: makeAccount(OTHER_ADDRESS, smartMetadata(nevmNetwork.chainId)),
        },
      },
      { ...nevmNetwork, kind: INetworkType.Syscoin, slip44: 1 }
    );

    expect(result.accounts).toEqual([]);
    expect(result.addresses).toEqual([]);
    expect(result.incompatibleSmartAddresses).toEqual(new Set([OTHER_ADDRESS]));
  });
});
