import {
  isDappMessageMethod,
  readDappMessageRequest,
  matchesDappMessageRequest,
  type DappMessageMethod,
} from '../../../shared/dappMessageRequest';
import {
  createDappSigningApproval,
  dappSigningApprovalExpired,
} from '../../../wallet/dappSigningApproval';
import { isRequestDocumentLive } from '../controllers/message-handler/request-lifetime';
import type { IDApp } from 'state/dapp/types';
import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { createDappApprovalLifetime } from 'utils/dappApprovalLifetime';
import { matchAttestedDappOrigin } from 'utils/dappOrigin';
import { prepareSmartAccountMessage } from 'utils/smartAccount/messageSigning';
import { getInstalledValidatorModuleByAddress } from 'utils/smartAccount/modules';

import type { IEnhancedRequestContext } from '../controllers/message-handler/types';

const grantReplacements = new WeakMap<AbortSignal, (grant: IDApp) => void>();

export const getMessageSignGrantReplacement = (signal?: AbortSignal) =>
  signal && grantReplacements.get(signal);

/** Keep the original grant across both existing queues, including reexecution. */
export const watchConnectedMessageSignGrant = ({
  host,
  method,
  sender,
  signal,
}: IEnhancedRequestContext['originalRequest']) => {
  if (
    !isDappMessageMethod(method) ||
    !sender?.documentId ||
    matchAttestedDappOrigin(sender.url, sender.origin) !== host ||
    getMessageSignGrantReplacement(signal)
  )
    return;
  const state = store.getState();
  let grant = state.dapp.dapps[host];
  if (
    grant?.chain !== INetworkType.Ethereum ||
    state.vault.activeNetwork.kind !== INetworkType.Ethereum
  )
    return;

  let successor: IDApp | undefined;
  const lifetime = createDappApprovalLifetime(() => {
    const current = store.getState().dapp.dapps[host];
    // Only the exact replacement staged by this request's approved durable
    // account selection may continue it. Removal or any other write retires it.
    if (successor && current === successor) {
      grant = successor;
      successor = undefined;
    }
    return current === grant;
  }, signal);
  const unsubscribe = store.subscribe(lifetime.isCurrent);
  grantReplacements.set(lifetime.signal, (next) => {
    if (!lifetime.isCurrent()) throw dappSigningApprovalExpired();
    successor = next;
  });
  return {
    signal: lifetime.signal,
    dispose() {
      unsubscribe();
      grantReplacements.delete(lifetime.signal);
      lifetime.dispose();
    },
  };
};

export const captureMessageSignApproval = ({
  host,
  method,
  params,
  sender,
  signal,
  getWalletSessionGeneration,
}: {
  getWalletSessionGeneration: () => number;
  host: string;
  method: DappMessageMethod;
  params: unknown;
  sender?: chrome.runtime.MessageSender;
  signal?: AbortSignal;
}) => {
  if (
    sender?.tab?.id === undefined ||
    !sender.documentId ||
    matchAttestedDappOrigin(sender.url, sender.origin) !== host
  )
    throw dappSigningApprovalExpired();

  const { dapp, vault } = store.getState();
  const grant = dapp.dapps[host];
  const { activeAccount, accounts, activeNetwork } = vault;
  const { id, type } = activeAccount;
  const { address } = accounts[type]?.[id] ?? {};
  const { chainId } = activeNetwork;
  if (
    grant?.chain !== INetworkType.Ethereum ||
    grant.accountId !== id ||
    grant.accountType !== type ||
    !address
  )
    throw dappSigningApprovalExpired();

  const request = readDappMessageRequest(method, params, address);
  const lifetime = createDappSigningApproval({
    signal,
    subscribe: (changed) => store.subscribe(changed),
    readScope: () => {
      const state = store.getState();
      const current = state.vault;
      const selected = current.activeAccount;
      const account = current.accounts[selected.type]?.[selected.id];
      return {
        grant: state.dapp.dapps[host],
        account: {
          ...selected,
          address: account?.address,
          xpub: account?.xpub,
        },
        isBitcoinBased: current.isBitcoinBased,
        network: current.activeNetwork,
        sessionGeneration: getWalletSessionGeneration(),
      };
    },
  });
  const assertCurrent = lifetime.assertCurrent;
  const assertLiveDocument = (live: boolean) => {
    if (!live) lifetime.retire();
    assertCurrent();
  };

  return {
    signal: lifetime.signal,
    isCurrent: lifetime.isCurrent,
    retire: lifetime.retire,
    assertCurrent,
    async checkDocument(
      approverIsLive: () => Promise<boolean>,
      recheckSite?: true
    ) {
      assertCurrent();
      assertLiveDocument(await isRequestDocumentLive(sender));
      // A same-URL reload can retire the approver while the site probe waits.
      assertLiveDocument(await approverIsLive());
      // A requesting iframe can disappear while the approver probe waits.
      if (recheckSite) assertLiveDocument(await isRequestDocumentLive(sender));
    },
    matches(args: unknown, signingMethod: string) {
      return (
        request !== undefined &&
        signingMethod ===
          (request.method === 'personal_sign'
            ? 'signPersonalMessage'
            : 'signTypedData') &&
        matchesDappMessageRequest(request, args)
      );
    },
    bindSmartAccountSigner(args: unknown) {
      if (
        type !== KeyringAccountType.SmartAccount ||
        !request ||
        (request.method !== 'personal_sign' &&
          request.method !== 'eth_signTypedData_v4') ||
        !Array.isArray(args) ||
        args.length !== 3
      )
        return;

      const [selectedSigner, activeValidator, signerValidator] = args;
      if (
        typeof activeValidator !== 'string' ||
        typeof signerValidator !== 'string'
      )
        return;

      const currentAccounts = store.getState().vault.accounts;
      const currentAccount = currentAccounts[type]?.[id];
      const metadata = currentAccount?.isSmartAccount
        ? currentAccount.smartAccount
        : undefined;
      // Require the exact hydrated active address, including for a composite.
      if (
        metadata?.chainId !== chainId ||
        metadata.auth?.validator?.toLowerCase() !==
          activeValidator.toLowerCase()
      )
        return;

      const active = getInstalledValidatorModuleByAddress(
        metadata,
        activeValidator
      );
      const signer = signerValidator.toLowerCase();
      const validator =
        signer === active?.address.toLowerCase()
          ? active
          : active?.id === 'composite' &&
            active.config.childValidators.some(
              (child) => child.toLowerCase() === signer
            ) &&
            getInstalledValidatorModuleByAddress(metadata, signer);
      if (!validator) return;

      const getDigest = () =>
        prepareSmartAccountMessage({
          accountAddress: address,
          chainId,
          request,
        }).actionHash;
      const hasMetadata = (next: typeof accounts) => {
        const account = next[type]?.[id];
        return account?.isSmartAccount && account.smartAccount === metadata;
      };
      if (validator.id === 'slh-dsa') {
        const { keyId, parameterSet, pkRoot, pkSeed } = validator.config;
        if (selectedSigner !== keyId) return;
        const actionHash = getDigest();
        lifetime.bindSigner('slh-dsa', () =>
          hasMetadata(store.getState().vault.accounts)
        );
        return {
          method: 'signSLHDSAActionHash' as const,
          args: [
            { accountId: id, actionHash, keyId, parameterSet, pkRoot, pkSeed },
          ],
        };
      }

      const owner = selectedSigner;
      if (
        validator.id !== 'ecdsa' ||
        typeof owner?.address !== 'string' ||
        !Number.isSafeInteger(owner.id) ||
        owner.id < 0 ||
        ![
          KeyringAccountType.HDAccount,
          KeyringAccountType.Imported,
          KeyringAccountType.Ledger,
          KeyringAccountType.Trezor,
        ].includes(owner.type)
      )
        return;
      const { id: ownerId, type: ownerType } = owner;
      const ownerAddress = owner.address.toLowerCase();
      const currentOwner = currentAccounts[ownerType]?.[ownerId];
      if (
        currentOwner?.address?.toLowerCase() !== ownerAddress ||
        !validator.config.owners.some(
          (configured) => configured.toLowerCase() === ownerAddress
        )
      )
        return;

      const digest = getDigest();
      // A change to this hydrated validator or owner retires the whole
      // approval, including composite siblings already in flight.
      lifetime.bindSigner(`${ownerType}:${ownerId}`, () => {
        const next = store.getState().vault.accounts;
        const current = next[ownerType]?.[ownerId];
        return (
          hasMetadata(next) &&
          current?.address === currentOwner.address &&
          current.xpub === currentOwner.xpub
        );
      });
      return {
        method: 'signSmartAccountActionDigestInternal' as const,
        args: [
          [currentOwner.address, digest],
          { id: ownerId, type: ownerType },
          undefined,
        ],
      };
    },
    dispose() {
      lifetime.dispose();
    },
  };
};

type MessageSignApproval = ReturnType<typeof captureMessageSignApproval>;
const approvals = new Map<
  string,
  { approval: MessageSignApproval; approverIsLive: () => Promise<boolean> }
>();

/** Only a Chrome-authenticated approval document can be bound by the popup. */
export const bindMessageSignApproval = (
  documentId: string,
  approval: MessageSignApproval,
  approverIsLive: () => Promise<boolean>
) => {
  const binding = { approval, approverIsLive };
  approvals.set(documentId, binding);
  return () => {
    if (approvals.get(documentId) === binding) approvals.delete(documentId);
  };
};

const isMessageApprovalDocument = (
  sender: chrome.runtime.MessageSender
): boolean => {
  if (sender.documentId && approvals.has(sender.documentId)) return true;
  try {
    const url = new URL(sender.url || '');
    if (
      url.pathname === '/external/tx/ethSign' ||
      url.searchParams.get('externalRoute') === 'tx/ethSign'
    )
      return true;
    return (
      url.pathname === '/external.html' &&
      isDappMessageMethod(
        JSON.parse(url.searchParams.get('data') || '{}').eventName
      )
    );
  } catch {
    return false;
  }
};

export const requireMessageSignApproval = (
  sender: chrome.runtime.MessageSender,
  methods: unknown,
  args: unknown
) => {
  if (!Array.isArray(methods) || methods[0] !== 'wallet') return undefined;
  const rawDigest =
    (methods.length === 2 &&
      ['signSmartAccountActionDigestInternal', 'signSLHDSAActionHash'].includes(
        methods[1]
      )) ||
    (methods.length === 3 &&
      methods[1] === 'ethereumTransaction' &&
      methods[2] === 'ethSign');
  // Transaction/module flows retain their own reviewed digest entry points.
  // A message document must use its worker-derived message capability instead.
  if (rawDigest && isMessageApprovalDocument(sender))
    throw dappSigningApprovalExpired();
  const smartAccount =
    methods.length === 2 && methods[1] === 'signSmartAccountMessageDigest';
  if (
    !smartAccount &&
    (methods.length !== 3 ||
      methods[1] !== 'ethereumTransaction' ||
      !['signPersonalMessage', 'signTypedData'].includes(methods[2]))
  )
    return undefined;
  const binding = sender.documentId && approvals.get(sender.documentId);
  if (!binding) throw dappSigningApprovalExpired();
  const { approval, approverIsLive } = binding;
  approval.assertCurrent();
  const signer = smartAccount
    ? approval.bindSmartAccountSigner(args)
    : undefined;
  if (smartAccount ? !signer : !approval.matches(args, methods[2]))
    throw dappSigningApprovalExpired();
  return {
    signer,
    assertCurrent: approval.assertCurrent,
    checkDocument: (recheckSite?: true) =>
      approval.checkDocument(approverIsLive, recheckSite),
  };
};

export { dappSigningApprovalExpired } from '../../../wallet/dappSigningApproval';
