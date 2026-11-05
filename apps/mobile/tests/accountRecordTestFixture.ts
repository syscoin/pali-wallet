import { stageInitialWallet } from '../../../source/wallet/accountRecovery.ts';
import { createNativeAccountRecord, type NativeAccountRecord } from '../src/custody/walletCatalogue.ts';
import { importAccountWithRecovery } from '../../../source/wallet/importedAccountRecovery.ts';

export const ACCOUNT_FIXTURE_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const ACCOUNT_FIXTURE_PASSWORD = 'Public complete account-record fixture 1!';
const current = () => undefined;

/** Actual SDK-encrypted records; no invented private-key ciphertext or dev schema. */
export async function createAccountRecordTestFixture() {
  const sdk = await import('@sidhujag/sysweb3-keyring/cjs/software.js');
  const staged = await stageInitialWallet({ key: '60', phrase: ACCOUNT_FIXTURE_PHRASE, password: ACCOUNT_FIXTURE_PASSWORD,
    network: { kind: sdk.INetworkType.Ethereum, chainId: 1, slip44: 60, currency: 'ETH', url: 'https://offline.invalid', label: 'Ethereum' } },
  { assertCurrent: current, loadSdk: async () => sdk });
  const values = new Map<string, unknown>([['vault', staged.pair.vault], ['vault-keys', staged.pair.keys]]);
  const storage = { async get(key: string) { return values.get(key); }, async set(key: string, value: unknown) { values.set(key, value); },
    async deleteItem(key: string) { values.delete(key); }, async createManyIfAbsent(entries: Record<string, unknown>) {
      if (Object.keys(entries).some(key => values.has(key))) return false;
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
      return true;
    } };
  const keyring = new sdk.SoftwareKeyring(sdk.createKeyringHost(storage));
  const group = structuredClone(staged.groups[0]!);
  const state = { activeAccount: group.activeAccount, activeNetwork: group.activeNetwork, accounts: group.accounts };
  keyring.setVaultStateGetter(() => state);
  const unlocked = await keyring.unlock(ACCOUNT_FIXTURE_PASSWORD);
  if (!unlocked.canLogin) throw Error('Test SDK fixture did not unlock');
  const root = state.accounts.HDAccount[0]!;
  return {
    staged, keyring, state,
    identity: { address: root.address, publicKey: root.xpub.toLowerCase() },
    pair: { vault: staged.pair.vault, 'vault-keys': staged.pair.keys },
    record(binding: string) { return createNativeAccountRecord(staged, binding); },
    useRecord(record: NativeAccountRecord) {
      const saved = structuredClone(record.groups.find(group => group.activeNetwork.slip44 === 60)!);
      state.accounts = saved.accounts; state.activeAccount = saved.activeAccount; state.activeNetwork = saved.activeNetwork;
    },
    async derive(index: number, label = `Account ${index + 1}`) {
      const account = await keyring.deriveEvmHdRuntimeAccount({ index }, { assertCurrent: current });
      return { ...account, label };
    },
    async imported(secret: string, label = 'Imported') {
      return importAccountWithRecovery(keyring, { secret, label, network: { kind: 'ethereum', slip44: 60 } }, current);
    },
    async close() { await keyring.destroy(); values.clear(); },
  };
}
