import { utf8ByteLength } from '../platformRpc.ts';
import { parseAccountSelection, type AccountSelection } from './accountDirectory.ts';
import type { PublicAccount } from './types.ts';
import { validatePublicAccounts } from './watchOnlyAuthority.ts';

export const PUBLIC_ACCOUNTS_KEY = 'pali.mobile.public-accounts.v1';
export const ACCOUNT_SELECTION_KEY = 'pali.mobile.account-selection.v1';
export type PublicStoragePort = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}>;
function assertSize(raw: string, limit: number): void {
  if (raw.length > limit || utf8ByteLength(raw) > limit) throw new Error('Public account configuration is too large');
}

/** One serialized repository for public data. No native vault handle is accepted. */
export function createPublicAccountStorage(port: PublicStoragePort) {
  let queue: Promise<void> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }
  async function readAccounts(): Promise<readonly PublicAccount[]> {
    const raw = await port.get(PUBLIC_ACCOUNTS_KEY);
    // Only an explicit missing key is empty. Corrupt/unknown records are retained.
    if (raw === null) return Object.freeze([]);
    assertSize(raw, 32 * 1024);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Unsupported public account configuration');
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || Object.keys(record).some((key) => key !== 'version' && key !== 'accounts')) throw new Error('Unsupported public account configuration');
    return validatePublicAccounts(record.accounts);
  }
  async function readSelection(): Promise<AccountSelection | null> {
    const raw = await port.get(ACCOUNT_SELECTION_KEY);
    if (raw === null) return null;
    assertSize(raw, 256);
    return parseAccountSelection(JSON.parse(raw));
  }
  return Object.freeze({
    loadAccounts: (): Promise<readonly PublicAccount[]> => serialized(readAccounts),
    compareAndSetAccounts: (expected: readonly PublicAccount[], accounts: readonly PublicAccount[]): Promise<void> => {
      const validated = validatePublicAccounts(accounts);
      const expectedJson = JSON.stringify(validatePublicAccounts(expected));
      const raw = JSON.stringify({ version: 1, accounts: validated });
      assertSize(raw, 32 * 1024);
      return serialized(async () => {
        if (JSON.stringify(await readAccounts()) !== expectedJson) throw new Error('Saved watch accounts changed. Reopen them before saving.');
        await port.set(PUBLIC_ACCOUNTS_KEY, raw);
        if (JSON.stringify(await readAccounts()) !== JSON.stringify(validated)) throw new Error('Saved watch accounts could not be verified.');
      });
    },
    loadSelection: (): Promise<AccountSelection | null> => serialized(readSelection),
    saveSelection: (selection: AccountSelection | null): Promise<void> => {
      const checked = parseAccountSelection(selection);
      return serialized(async () => {
        // An unreadable existing hint is preserved rather than replaced.
        await readSelection();
        await port.set(ACCOUNT_SELECTION_KEY, JSON.stringify(checked));
        if (JSON.stringify(await readSelection()) !== JSON.stringify(checked)) throw new Error('Saved account choice could not be verified.');
      });
    },
  });
}
