import assert from 'node:assert/strict';
import { keccak256 } from 'ethers/crypto';
import type { DappGrant } from '../../../source/shared/dappTypes.ts';
import type { DappMessageRequest } from '../../../source/shared/dappMessageRequest.ts';
import { createDappSigningApproval } from '../../../source/wallet/dappSigningApproval.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime, KeyringRuntimeDependencies } from '../src/custody/keyringRuntime.ts';

export function approveHardwareDappRequest(
  owner: NativeCustodyAuthority,
  host: Awaited<ReturnType<KeyringRuntime['openConnectionHost']>>,
  request: DappMessageRequest
) {
  const accountId = host.context().activeAccountId!;
  const approved = host.context().accounts.find(value => value.id === accountId)!;
  const grant: DappGrant = { accountId: approved.index, accountType: approved.type as DappGrant['accountType'],
    chain: 'ethereum' as DappGrant['chain'], chainId: host.context().network.chainId,
    date: 1, host: 'https://hardware-dapp.example' };
  const approval = createDappSigningApproval({
    readScope() {
      const context = host.context(), account = context.accounts.find(value => value.id === accountId);
      return { account: { id: approved.index, type: approved.type, address: account?.address, xpub: account?.xpub },
        grant, isBitcoinBased: context.network.kind !== 'ethereum', network: context.network,
        sessionGeneration: host.sessionGeneration() };
    },
    subscribe: changed => owner.subscribe(changed),
  });
  return { accountId, networkId: host.context().networkId, request, approval };
}

/** Public RPC fixture only: device and signing execution stay in the actual SDK. */
export function hardwareDappRpc() {
  const rawTransactions: string[] = [], reports: string[] = [];
  let admission: ((hash: string, raw: string) => Promise<void>) | undefined;
  let loseReply = false;
  const fetch: NonNullable<KeyringRuntimeDependencies['connectionFetch']> = async (_url, init) => {
    const { id, method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === 'eth_chainId') result = '0x1';
    else if (method === 'eth_getTransactionCount') result = '0x0';
    else if (method === 'eth_getBalance') result = '0x10000000000000000';
    else if (method === 'eth_getBlockByNumber') result = { number: params[0] === 'latest' ? '0x10' : params[0],
      hash: '0x' + 'aa'.repeat(32), gasLimit: '0x1c9c380', baseFeePerGas: '0x1' };
    else if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') result = '0x2';
    else if (method === 'eth_estimateGas') result = '0x10000';
    else if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') result = null;
    else if (method === 'eth_sendRawTransaction') {
      const raw = params[0] as string, hash = keccak256(raw);
      assert.equal(reports.at(-1), hash, 'request learns the canonical hash before POST');
      await admission?.(hash, raw);
      rawTransactions.push(raw);
      if (loseReply) throw Error('lost hardware submission reply');
      result = hash;
    } else throw Error('Unexpected hardware fixture RPC ' + method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  return { fetch, rawTransactions, reports, onAdmission(hook: typeof admission) { admission = hook; },
    loseReply() { loseReply = true; } };
}
