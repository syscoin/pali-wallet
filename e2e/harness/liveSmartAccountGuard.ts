import { Interface } from 'ethers/abi';
import { getAddress } from 'ethers/address';
import { Transaction } from 'ethers/transaction';

export const LIVE_SA_CHAIN_ID = BigInt(57057);
export const LIVE_SA_ENTRYPOINT = '0x433709009B8330FDa32311DF1C2AFA402eD8D009';
export const LIVE_SA_GUARDIAN_MODULE =
  '0x8f919fc9a92da490d305054bfd862379d2760f84';
export const LIVE_SA_MAX_ORIGINALS = 60;
// Fake SYS only: current zkSYS fee floor is 30 gwei and a real SLH verifier
// needs substantially more than the prior millitoken smoke-test allowance.
// These cumulative ceilings remain below the isolated runner's 10-SYS top-up.
export const LIVE_SA_MAX_FEE_WEI = BigInt('5000000000000000000');
export const LIVE_SA_MAX_PREFUND_WEI = BigInt('3000000000000000000');

const entryPoint = new Interface([
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
]);
const recovery = new Interface([
  'function scheduleRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata,(address guardian,bytes signature)[] approvals)',
  'function executeRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata)',
  'function cancelRecovery(address account,bytes32 salt,bytes32 mode,bytes executionCalldata)',
]);

export interface ILiveSmartAccountGuardOptions {
  maxFeeWei?: bigint;
  maxOriginals?: number;
  maxPrefundWei?: bigint;
  payers: ReadonlyArray<{ address: string; nextNonce: number }>;
}

export interface ILiveSmartAccountIntent {
  account?: string;
  beneficiary?: string;
  chainId: '57057';
  data: string;
  feeUpperBoundWei: string;
  from: string;
  gasLimit: string;
  hash: string;
  kind: 'native-prefund' | 'handleOps' | 'guardian-recovery';
  maxFeePerGasWei: string;
  nonce: number;
  operation?: 'scheduleRecovery' | 'executeRecovery' | 'cancelRecovery';
  to: string;
  type: number;
  userOperationNonce?: string;
  valueWei: string;
}

type Status = 'reserved' | 'unknown' | 'published' | 'not-published';
interface IRecord {
  intent: Readonly<ILiveSmartAccountIntent>;
  status: Status;
}

const normalized = (address: string) => getAddress(address).toLowerCase();
const positiveBound = (value: bigint, ceiling: bigint, name: string) => {
  if (typeof value !== 'bigint' || value < BigInt(0) || value > ceiling)
    throw new Error(`Invalid ${name} bound`);
  return value;
};

/**
 * Pure, in-memory testnet publication fence. It never signs, sends, retries,
 * reads a provider, or persists. Root must review nested UserOp/recovery data:
 * these limits bound outer fees and native prefunds, not arbitrary SA spending.
 * Keep this instance alive for the entire run; reconstructing it loses its ledger.
 */
export class LiveSmartAccountGuard {
  private readonly payers = new Map<string, number>();
  private readonly smartAccounts = new Set<string>();
  private readonly records = new Map<string, IRecord>();
  private readonly occupiedNonces = new Set<string>();
  private readonly stoppedPayers = new Set<string>();
  private readonly maxOriginals: number;
  private readonly maxFeeWei: bigint;
  private readonly maxPrefundWei: bigint;
  private feeWei = BigInt(0);
  private prefundWei = BigInt(0);
  private pendingHash: string | undefined;

  constructor(options: ILiveSmartAccountGuardOptions) {
    const maxOriginals = options.maxOriginals ?? LIVE_SA_MAX_ORIGINALS;
    if (
      !Number.isSafeInteger(maxOriginals) ||
      maxOriginals < 1 ||
      maxOriginals > LIVE_SA_MAX_ORIGINALS ||
      !Array.isArray(options.payers) ||
      !options.payers.length
    )
      throw new Error('Invalid original/payer bounds');
    this.maxOriginals = maxOriginals;
    this.maxFeeWei = positiveBound(
      options.maxFeeWei ?? LIVE_SA_MAX_FEE_WEI,
      LIVE_SA_MAX_FEE_WEI,
      'fee'
    );
    this.maxPrefundWei = positiveBound(
      options.maxPrefundWei ?? LIVE_SA_MAX_PREFUND_WEI,
      LIVE_SA_MAX_PREFUND_WEI,
      'prefund'
    );
    for (const payer of options.payers) {
      const address = normalized(payer.address);
      if (
        this.payers.has(address) ||
        address === '0x0000000000000000000000000000000000000000' ||
        address === normalized(LIVE_SA_ENTRYPOINT) ||
        address === normalized(LIVE_SA_GUARDIAN_MODULE) ||
        !Number.isSafeInteger(payer.nextNonce) ||
        payer.nextNonce < 0 ||
        payer.nextNonce >= Number.MAX_SAFE_INTEGER
      )
        throw new Error('Invalid payer or initial nonce');
      this.payers.set(address, payer.nextNonce);
    }
  }

  // Root attests this is a fresh, owned SA created through normal Pali UI.
  // No freshness/deployment assertion can be established by this pure helper.
  addSmartAccount(address: string): void {
    const account = normalized(address);
    if (
      this.pendingHash ||
      this.smartAccounts.has(account) ||
      this.payers.has(account) ||
      account === '0x0000000000000000000000000000000000000000' ||
      account === normalized(LIVE_SA_ENTRYPOINT) ||
      account === normalized(LIVE_SA_GUARDIAN_MODULE)
    )
      throw new Error('Cannot add smart account');
    this.smartAccounts.add(account);
  }

  reserve(raw: string): Readonly<ILiveSmartAccountIntent> {
    if (this.pendingHash)
      throw new Error('Unresolved publication: Root reconciliation required');
    let tx: Transaction;
    try {
      tx = Transaction.from(raw);
      if (!tx.isSigned() || !tx.from || !tx.hash)
        throw new Error('Missing signature');
    } catch {
      throw new Error('Expected a valid signed raw transaction');
    }
    if (tx.chainId !== LIVE_SA_CHAIN_ID)
      throw new Error('Wrong chain: only 57057 is allowed');
    if (tx.type !== 0 && tx.type !== 1 && tx.type !== 2)
      throw new Error('Unsupported transaction type');
    const from = normalized(tx.from!);
    const to = tx.to && normalized(tx.to);
    if (!this.payers.has(from) || this.stoppedPayers.has(from))
      throw new Error('Unapproved or stopped payer');
    const hash = tx.hash!.toLowerCase();
    const nonceKey = `${from}:${tx.nonce}`;
    if (this.records.has(hash) || this.occupiedNonces.has(nonceKey))
      throw new Error('Duplicate original hash or sender nonce');
    if (tx.nonce !== this.payers.get(from))
      throw new Error('Unexpected payer nonce');
    if (!to) throw new Error('Contract creation is not allowed');
    const price = tx.type === 2 ? tx.maxFeePerGas : tx.gasPrice;
    if (
      price === null ||
      tx.gasLimit <= BigInt(0) ||
      (tx.type === 2 &&
        (tx.maxPriorityFeePerGas === null || tx.maxPriorityFeePerGas > price))
    )
      throw new Error('Invalid gas/fee fields');
    const fee = tx.gasLimit * price;
    if (this.records.size >= this.maxOriginals)
      throw new Error('Original count bound exceeded');
    if (this.feeWei + fee > this.maxFeeWei)
      throw new Error('Aggregate fee bound exceeded');

    const intent: ILiveSmartAccountIntent = {
      chainId: '57057',
      data: tx.data,
      feeUpperBoundWei: fee.toString(),
      from,
      gasLimit: tx.gasLimit.toString(),
      hash,
      kind: 'native-prefund',
      maxFeePerGasWei: price.toString(),
      nonce: tx.nonce,
      to,
      type: tx.type,
      valueWei: tx.value.toString(),
    };
    let prefund = BigInt(0);
    if (tx.data === '0x') {
      if (!this.isOwned(to) || tx.value <= BigInt(0))
        throw new Error('Native prefund destination/value is not allowed');
      prefund = tx.value;
      if (this.prefundWei + prefund > this.maxPrefundWei)
        throw new Error('Aggregate native prefund bound exceeded');
    } else if (to === normalized(LIVE_SA_ENTRYPOINT)) {
      if (tx.value !== BigInt(0))
        throw new Error('EntryPoint attached value must be zero');
      const parsed = this.parseCanonical(entryPoint, tx.data);
      const ops = parsed.args[0];
      if (parsed.name !== 'handleOps' || ops.length !== 1)
        throw new Error('Exactly one UserOperation is allowed');
      const account = normalized(ops[0].sender);
      const beneficiary = normalized(parsed.args[1]);
      if (!this.smartAccounts.has(account) || !this.isOwned(beneficiary))
        throw new Error('Unapproved UserOperation account/beneficiary');
      intent.account = account;
      intent.beneficiary = beneficiary;
      intent.userOperationNonce = ops[0].nonce.toString();
      intent.kind = 'handleOps';
    } else if (to === normalized(LIVE_SA_GUARDIAN_MODULE)) {
      if (tx.value !== BigInt(0))
        throw new Error('Recovery attached value must be zero');
      const parsed = this.parseCanonical(recovery, tx.data);
      const account = normalized(parsed.args[0]);
      if (!this.smartAccounts.has(account))
        throw new Error('Unapproved recovery account');
      intent.account = account;
      intent.kind = 'guardian-recovery';
      intent.operation = parsed.name as ILiveSmartAccountIntent['operation'];
    } else {
      throw new Error('Unapproved destination or selector');
    }

    // No await/IO between validation and occupation. A failed send must not
    // release this original, its nonce or its reserved upper-bound budgets.
    const frozen = Object.freeze(intent);
    this.records.set(hash, { intent: frozen, status: 'reserved' });
    this.occupiedNonces.add(nonceKey);
    this.payers.set(from, tx.nonce + 1);
    this.feeWei += fee;
    this.prefundWei += prefund;
    this.pendingHash = hash;
    return frozen;
  }

  ack(hash: string): void {
    const record = this.pending(hash);
    if (record.status !== 'reserved')
      throw new Error('Unknown publication requires explicit reconciliation');
    record.status = 'published';
    this.pendingHash = undefined;
  }

  markUnknown(hash: string): void {
    const record = this.pending(hash);
    if (record.status !== 'reserved') throw new Error('Already unknown');
    record.status = 'unknown';
  }

  reconcile(hash: string, outcome: 'published' | 'not-published'): void {
    const record = this.pending(hash);
    if (
      record.status !== 'unknown' ||
      (outcome !== 'published' && outcome !== 'not-published')
    )
      throw new Error('Expected an unknown publication and explicit outcome');
    record.status = outcome;
    if (outcome === 'not-published') this.stoppedPayers.add(record.intent.from);
    this.pendingHash = undefined;
  }

  snapshot() {
    return {
      feeUpperBoundWei: this.feeWei.toString(),
      originals: [...this.records.values()].map(({ intent, status }) => ({
        ...intent,
        status,
      })),
      pendingHash: this.pendingHash ?? null,
      prefundWei: this.prefundWei.toString(),
      stoppedPayers: [...this.stoppedPayers],
    };
  }

  private pending(hash: string): IRecord {
    const key = hash.toLowerCase();
    const record = this.records.get(key);
    if (this.pendingHash !== key || !record)
      throw new Error('No matching unresolved original');
    return record;
  }

  private isOwned(address: string): boolean {
    return this.payers.has(address) || this.smartAccounts.has(address);
  }

  private parseCanonical(iface: Interface, data: string) {
    try {
      const parsed = iface.parseTransaction({ data });
      if (
        !parsed ||
        iface.encodeFunctionData(parsed.fragment, parsed.args).toLowerCase() !==
          data.toLowerCase()
      )
        throw new Error('Noncanonical calldata');
      return parsed;
    } catch {
      throw new Error('Unknown selector or noncanonical calldata');
    }
  }
}
