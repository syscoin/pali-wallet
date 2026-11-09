import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  reviewDappMessageAdvisories,
  type DappAddressAdvisory,
} from '../../shared/dappMessageAdvisories';
import {
  Button,
  DeviceWaitingBanner,
  ErrorModal,
  Icon,
  IconButton,
  WarningModal,
} from 'components/index';
import { LoadingComponent, PqSigningOverlay } from 'components/Loading';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { TypedOrderReview } from 'components/TypedOrderReview/TypedOrderReview';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ISmartAccountMetadata } from 'types/network';
import { IBlacklistCheckResult } from 'types/security';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { handleTransactionError } from 'utils/errorHandling';
import { isHexString } from 'utils/ethersV6Compat';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';
import { getNetworkChain } from 'utils/network';
import {
  getPersonalSignParams,
  preparePersonalSignReview,
} from 'utils/personalSignReview';
import {
  assertPaliErc7739TypedDataV4Method,
  encodeSmartAccountAuthenticatorSignature,
  getPaliErc7739PersonalSignHash,
  getSmartAccountLocalOwnerContexts,
  signSmartAccountActionHash,
} from 'utils/smartAccount';
import {
  prepareSmartAccountMessage,
  encodeSmartAccountMessageSignature,
} from 'utils/smartAccount/messageSigning';
import { getTypedOrderReview } from 'utils/typedOrderReview';

import type { DappMessageRequest } from '../../shared/dappMessageRequest';

interface ISign {
  send?: boolean;
}

const EthSign: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const requestData = useQueryData();
  const { host, ...data } = requestData;
  const { t } = useTranslation();
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<string>('Details');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPqSigning, setIsPqSigning] = useState(false);
  const [message, setMessage] = useState<string>('');
  const signingRef = React.useRef<'ready' | 'submitting' | 'completed'>(
    'ready'
  );
  const mountedRef = React.useRef(true);
  const errorCloseRevisionRef = React.useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      errorCloseRevisionRef.current += 1;
    };
  }, []);
  const scheduleErrorClose = () => {
    if (!mountedRef.current) return;
    const revision = ++errorCloseRevisionRef.current;
    createTemporaryAlarm({
      delayInSeconds: 40,
      callback: () => {
        if (
          !mountedRef.current ||
          errorCloseRevisionRef.current !== revision ||
          signingRef.current !== 'ready'
        )
          return;
        signingRef.current = 'completed';
        window.close();
      },
    });
  };
  const handleClose = () => {
    if (!mountedRef.current || signingRef.current !== 'ready') return;
    signingRef.current = 'completed';
    errorCloseRevisionRef.current += 1;
    window.close();
  };
  const [blacklistWarning, setBlacklistWarning] = useState<{
    address?: string;
    fieldName?: string;
    reason?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    show: boolean;
  }>({ show: false });
  const [blacklistedAddresses, setBlacklistedAddresses] = useState<
    readonly DappAddressAdvisory[]
  >([]);

  const tabLabel = ['Details', 'Data'];
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    ({ vault }: RootState) => vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeNetwork = useSelector(
    ({ vault }: RootState) => vault.activeNetwork
  );
  const { isBitcoinBased } = useSelector(({ vault }: RootState) => vault);
  const { label, balances, address } = activeAccount;
  const { currency } = activeNetwork;

  // Get the action type for better UX messaging
  const getActionType = () => {
    switch (data.eventName) {
      case 'eth_sign':
        return t('send.signMessage');
      case 'personal_sign':
        return t('send.signPersonalMessage');
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        return t('send.signTypedData');
      default:
        return t('send.signMessage');
    }
  };

  const getMessageDescription = () => {
    switch (data.eventName) {
      case 'eth_sign':
        return t('send.signingMessage');
      case 'personal_sign':
        return t('send.signingPersonalMessage');
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        return t('send.signingStructuredData');
      default:
        return t('send.signingGeneral');
    }
  };

  const isActiveAccountAddress = (value: unknown) =>
    typeof value === 'string' && value.toLowerCase() === address.toLowerCase();

  const personalSignReview = useMemo(
    () =>
      data.eventName === 'personal_sign'
        ? preparePersonalSignReview(data, host, address)
        : null,
    [
      data.eventName,
      data[0],
      data[1],
      host,
      address,
      activeAccountMeta.type,
      activeAccountMeta.id,
      activeNetwork.chainId,
      isBitcoinBased,
    ]
  );
  const displayMessage = personalSignReview?.message ?? message;
  const currentPersonalSignReviewRef = React.useRef(personalSignReview);
  currentPersonalSignReviewRef.current = personalSignReview;

  const getEthSignPayload = () => {
    if (isActiveAccountAddress(data[0])) {
      return String(data[1] || '');
    }

    if (isActiveAccountAddress(data[1])) {
      return String(data[0] || '');
    }

    throw { message: t('send.signingForWrongAddress') };
  };

  const getTypedDataPayload = () => {
    let typedData;
    if (isActiveAccountAddress(data[0])) {
      typedData = data[1];
    } else if (isActiveAccountAddress(data[1])) {
      typedData = data[0];
    } else {
      throw { message: t('send.signingForWrongAddress') };
    }

    return typeof typedData === 'string' ? JSON.parse(typedData) : typedData;
  };

  // Normalize legacy fields once for both review and signing, without changing
  // their values or assuming which parameter contains the account address.
  // Modern order-term advisories are not a verdict on the verifying contract.
  const typedOrderRequest = useMemo(() => {
    if (data.eventName === 'eth_signTypedData') {
      try {
        const legacyFields = getTypedDataPayload();
        if (
          !Array.isArray(legacyFields) ||
          legacyFields.length === 0 ||
          legacyFields.some(
            (field) =>
              !field ||
              typeof field !== 'object' ||
              Array.isArray(field) ||
              typeof field.name !== 'string' ||
              typeof field.type !== 'string' ||
              !Object.prototype.hasOwnProperty.call(field, 'value')
          )
        )
          throw new Error('Invalid legacy typed data');
        return { legacyFields, modernData: null, error: null, review: null };
      } catch {
        return {
          legacyFields: null,
          modernData: null,
          error: t(
            isActiveAccountAddress(data[0]) || isActiveAccountAddress(data[1])
              ? 'send.invalidApprovalDetails'
              : 'send.signingForWrongAddress'
          ),
          review: null,
        };
      }
    }
    if (
      data.eventName !== 'eth_signTypedData_v3' &&
      data.eventName !== 'eth_signTypedData_v4'
    )
      return null;
    try {
      const modernData = getTypedDataPayload();
      if (
        !modernData ||
        typeof modernData !== 'object' ||
        Array.isArray(modernData)
      )
        throw new Error('Invalid typed data');
      return {
        legacyFields: null,
        modernData,
        error: null,
        review: getTypedOrderReview(modernData),
      };
    } catch {
      return {
        legacyFields: null,
        modernData: null,
        error: t(
          isActiveAccountAddress(data[0]) || isActiveAccountAddress(data[1])
            ? 'send.invalidApprovalDetails'
            : 'send.signingForWrongAddress'
        ),
        review: null,
      };
    }
  }, [
    requestData,
    data.eventName,
    data[0],
    data[1],
    host,
    address,
    activeAccountMeta.id,
    activeAccountMeta.type,
    activeNetwork.chainId,
    activeNetwork.url,
    activeAccount.isSmartAccount,
    activeAccount.isLedgerWallet,
    activeAccount.isTrezorWallet,
    isBitcoinBased,
    t,
  ]);
  const currentTypedOrderRequestRef = React.useRef(typedOrderRequest);
  currentTypedOrderRequestRef.current = typedOrderRequest;

  const getHydratedSmartAccountMetadata =
    async (): Promise<ISmartAccountMetadata> => {
      if (!activeAccount.isSmartAccount || !activeAccount.smartAccount) {
        throw { message: t('send.smartAccountActiveAccountRequired') };
      }

      const personalIdentity = currentPersonalSignReviewRef.current;
      const typedIdentity = currentTypedOrderRequestRef.current;
      const metadata = (await controllerEmitter(
        ['wallet', 'hydrateSmartAccount'],
        [activeAccount.id],
        300000
      )) as ISmartAccountMetadata;
      if (
        !mountedRef.current ||
        signingRef.current !== 'submitting' ||
        currentPersonalSignReviewRef.current !== personalIdentity ||
        currentTypedOrderRequestRef.current !== typedIdentity
      )
        throw new Error('Signing request changed');
      return metadata;
    };

  const signSmartAccountHash = async (
    smartAccount: ISmartAccountMetadata,
    actionHash: string
  ) => {
    const messageIdentity = currentPersonalSignReviewRef.current;
    const typedIdentity = currentTypedOrderRequestRef.current;
    const generation = await controllerEmitter(
      ['wallet', 'getWalletSessionGeneration'],
      []
    );
    const signature = await signSmartAccountActionHash({
      async assertBeforeAuthentication() {
        if (
          !mountedRef.current ||
          signingRef.current !== 'submitting' ||
          currentPersonalSignReviewRef.current !== messageIdentity ||
          currentTypedOrderRequestRef.current !== typedIdentity
        )
          throw new Error('Signing request changed');
        if (
          (await controllerEmitter(
            ['wallet', 'getWalletSessionGeneration'],
            []
          )) !== generation
        )
          throw new Error('Signing request changed');
        if (
          !mountedRef.current ||
          currentPersonalSignReviewRef.current !== messageIdentity ||
          currentTypedOrderRequestRef.current !== typedIdentity
        )
          throw new Error('Signing request changed');
      },
      actionHash,
      authenticatorContexts: getSmartAccountLocalOwnerContexts({
        accounts,
        controllerEmitter,
        messageSignValidator: smartAccount.auth?.validator ?? '',
      }),
      onAuthenticatorSigningResolved: (authenticator) => {
        if (authenticator === 'slh-dsa') {
          setIsPqSigning(false);
        }
      },
      onAuthenticatorSigningStarted: (authenticator) => {
        if (authenticator === 'slh-dsa') {
          setIsPqSigning(true);
        }
      },
      smartAccount,
    });

    return encodeSmartAccountAuthenticatorSignature(signature);
  };

  const encodeSmartAccountEthSignSignature = async (hash: string) => {
    const smartAccount = await getHydratedSmartAccountMetadata();
    return signSmartAccountHash(
      smartAccount,
      getPaliErc7739PersonalSignHash({
        accountAddress: address,
        chainId: smartAccount.chainId,
        hash,
      })
    );
  };

  const signSmartAccountMessage = async (request: DappMessageRequest) => {
    const prepared = prepareSmartAccountMessage({
      accountAddress: address,
      chainId: activeNetwork.chainId,
      request,
    });
    const smartAccount = await getHydratedSmartAccountMetadata();
    if (smartAccount.chainId !== activeNetwork.chainId)
      throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    const moduleSignature = await signSmartAccountHash(
      smartAccount,
      prepared.actionHash
    );
    return encodeSmartAccountMessageSignature(prepared, moduleSignature);
  };

  const getSmartAccountEthSignHash = () => {
    if (data.eventName === 'eth_sign') {
      const ethSignPayload = getEthSignPayload();
      if (!isHexString(ethSignPayload, 32)) {
        throw {
          message: t('send.smartAccountEthSignHashRequired'),
        };
      }
      return ethSignPayload;
    }

    throw { message: t('send.smartAccountUnsupportedSigningRequest') };
  };

  const onSubmit = async () => {
    if (!mountedRef.current || signingRef.current !== 'ready' || confirmed)
      return;
    if (typedOrderRequest !== currentTypedOrderRequestRef.current) return;
    if (typedOrderRequest?.error) {
      setErrorMsg(typedOrderRequest.error);
      return;
    }
    // Only the currently displayed request may reach a signer, including
    // callbacks captured before an account, origin or payload change.
    const personalRequest = personalSignReview?.request;
    if (data.eventName === 'personal_sign') {
      if (personalSignReview !== currentPersonalSignReviewRef.current) return;
      if (personalSignReview?.error) {
        setErrorMsg(t(personalSignReview.error));
        return;
      }
      if (!personalRequest) return;
    }
    // An error deadline belongs only to the failed attempt that created it.
    // The alarm may already be queued when a retry starts, so invalidate it
    // synchronously before allowing another signer invocation.
    errorCloseRevisionRef.current += 1;
    signingRef.current = 'submitting';
    setLoading(true);

    // Safety check: signing is only for EVM networks
    if (isBitcoinBased) {
      signingRef.current = 'ready';
      setLoading(false);
      setErrorMsg(t('send.messageSigningNotAvailable'));
      scheduleErrorClose();
      return;
    }

    try {
      let response = '';
      const type = data.eventName;
      if (activeAccount.isSmartAccount && activeAccount.smartAccount) {
        const typedData =
          data.eventName === 'eth_signTypedData' ||
          data.eventName === 'eth_signTypedData_v3' ||
          data.eventName === 'eth_signTypedData_v4'
            ? data.eventName === 'eth_signTypedData'
              ? typedOrderRequest?.legacyFields
              : typedOrderRequest?.modernData
            : undefined;
        if (typedData) {
          if (data.eventName === 'eth_signTypedData') {
            throw {
              message: t('send.smartAccountLegacyTypedDataUnsupported'),
            };
          }
          assertPaliErc7739TypedDataV4Method(data.eventName);
          response = await signSmartAccountMessage({
            method: 'eth_signTypedData_v4',
            address,
            typedData,
            version: 'V4',
          });
        } else if (data.eventName === 'personal_sign' && personalRequest) {
          response = await signSmartAccountMessage({
            method: 'personal_sign',
            address,
            message: personalRequest.message,
          });
        } else {
          response = await encodeSmartAccountEthSignSignature(
            getSmartAccountEthSignHash()
          );
        }
      } else if (
        data.eventName === 'eth_signTypedData_v3' ||
        data.eventName === 'eth_signTypedData_v4'
      ) {
        const typedData = typedOrderRequest?.modernData;
        const version = data.eventName === 'eth_signTypedData_v3' ? 'V3' : 'V4';
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'signTypedData'],
          [address, typedData, version],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000
            : 10000
        )) as string;
      } else if (data.eventName === 'eth_sign')
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'ethSign'],
          [data],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : 10000 // Default 10 seconds for regular wallets
        )) as string;
      else if (personalRequest) {
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
          [[personalRequest.address, personalRequest.message]],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : 10000 // Default 10 seconds for regular wallets
        )) as string;
      } else {
        const typedData =
          data.eventName === 'eth_signTypedData'
            ? typedOrderRequest?.legacyFields
            : getTypedDataPayload();
        if (data.eventName === 'eth_signTypedData') {
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V1'],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          )) as string;
        } else if (data.eventName === 'eth_signTypedData_v3') {
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V3'],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          )) as string;
        } else if (data.eventName === 'eth_signTypedData_v4') {
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V4'],
            activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
              ? 300000 // 5 minutes timeout for hardware wallet operations
              : 10000 // Default 10 seconds for regular wallets
          )) as string;
        }
      }
      dispatchBackgroundEvent(`${type}.${host}`, response);
      if (!mountedRef.current) return;
      setConfirmed(true);
      signingRef.current = 'completed';
      errorCloseRevisionRef.current += 1;
      setLoading(false);

      window.close();
    } catch (error: any) {
      if (!mountedRef.current) return;
      // Create custom alert object that routes to appropriate display method
      const customAlert = {
        error: (msg: string) => setErrorMsg(msg),
        info: (msg: string) => alert.info(msg),
        warning: (msg: string) => setErrorMsg(msg),
        success: (msg: string) => alert.success(msg),
      };

      // Handle all errors with centralized handler
      const wasHandledSpecifically = handleTransactionError(
        error,
        customAlert,
        t,
        activeAccount,
        activeNetwork,
        undefined, // basicTxValues not available in this context (SignEth.tsx doesn't have fee/amount info)
        undefined // sanitizeErrorMessage not needed for ETH transactions
      );

      if (!wasHandledSpecifically) {
        // Fallback for non-structured errors
        console.log(error);
        setErrorMsg(
          error?.message === EVM_TRANSACTION_CONTEXT_CHANGED
            ? t('transactions.psbtSigningContextChanged')
            : error.message
        );
      }

      setLoading(false);
      scheduleErrorClose();
    } finally {
      if (signingRef.current === 'submitting') signingRef.current = 'ready';
    }
  };

  // The message itself is rendered directly from the prepared review.
  useEffect(() => {
    if (!personalSignReview) return;
    setErrorMsg(
      isBitcoinBased
        ? t('send.ethSigningNotAvailable')
        : personalSignReview.error
        ? t(personalSignReview.error)
        : ''
    );
  }, [personalSignReview, isBitcoinBased, t]);

  // Handle initial data loading
  useEffect(() => {
    const processInitialData = async () => {
      try {
        // Small delay to ensure data is properly loaded
        await new Promise((resolve) => setTimeout(resolve, 100));
        setInitialLoading(false);
      } catch (error) {
        console.error('Error processing initial data:', error);
        setInitialLoading(false);
      }
    };

    if (data) {
      processInitialData();
    } else {
      setInitialLoading(false);
    }
  }, [data]);

  useEffect(() => {
    // Safety check: ETH signing is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg(t('send.ethSigningNotAvailable'));
      return;
    }
    if (data.eventName === 'eth_sign') {
      // eth_sign parameters should be [address, message]
      let messageToSign = '';
      let requestedAddress = '';

      // Standard parameter order for eth_sign is [address, message]
      // Check if params follow the standard order
      const isFirstParamAddress =
        data[0] &&
        typeof data[0] === 'string' &&
        data[0].startsWith('0x') &&
        data[0].length === 42;

      const isSecondParamAddress =
        data[1] &&
        typeof data[1] === 'string' &&
        data[1].startsWith('0x') &&
        data[1].length === 42;

      if (isFirstParamAddress && !isSecondParamAddress) {
        // Standard order: [address, message]
        requestedAddress = data[0];
        messageToSign = data[1] || '';
      } else if (!isFirstParamAddress && isSecondParamAddress) {
        // Non-standard order: [message, address]
        messageToSign = data[0] || '';
        requestedAddress = data[1];
      } else {
        // Ambiguous - default to standard order
        requestedAddress = data[0] || '';
        messageToSign = data[1] || '';
      }

      // Validate that the requested address matches the active account
      if (
        requestedAddress &&
        requestedAddress.toLowerCase() !== activeAccount.address.toLowerCase()
      ) {
        setErrorMsg(t('send.signingForWrongAddress'));
        return;
      }

      // Validate that the message is a proper 32-byte hex string for eth_sign
      const cleanMsg = messageToSign.startsWith('0x')
        ? messageToSign.slice(2)
        : messageToSign;

      if (cleanMsg.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanMsg)) {
        // Message is not a proper hash - show warning
        setErrorMsg(t('send.invalidEthSignFormat', { message: messageToSign }));
        return;
      }

      setMessage(messageToSign);
    }
  }, []);

  useEffect(() => {
    if (copied) {
      alert.info(t('transactions.messageCopied'));
    }
  }, [copied, alert, t]);

  useEffect(() => {
    let cancelled = false;
    const captured = typedOrderRequest;
    setBlacklistedAddresses([]);
    setBlacklistWarning({ show: false });
    if (!captured?.modernData) return;

    const isCurrent = () =>
      !cancelled &&
      mountedRef.current &&
      signingRef.current !== 'completed' &&
      currentTypedOrderRequestRef.current === captured;
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error(EVM_TRANSACTION_CONTEXT_CHANGED);
    };
    reviewDappMessageAdvisories({
      method: data.eventName,
      typedData: captured.modernData,
      checkAddress: (target) =>
        controllerEmitter(
          ['wallet', 'checkAddressBlacklist'],
          [target]
        ) as Promise<IBlacklistCheckResult>,
      assertCurrent,
      onWarning: (warning) => {
        assertCurrent();
        setBlacklistWarning({
          ...warning,
          fieldName: warning.field,
          show: true,
        });
      },
    })
      .then(({ addresses }) => {
        if (!isCurrent()) return;
        if (addresses.length) setBlacklistedAddresses(addresses);
      })
      .catch((error) => {
        if (isCurrent())
          console.error('Error checking permit blacklist:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [controllerEmitter, data.eventName, typedOrderRequest]);

  const AccountDetailsSignature = () => (
    <div className="min-w-0 space-y-3">
      <div className="flex w-full items-start justify-between gap-3 font-poppins text-sm text-white">
        <span className="shrink-0 text-gray-300">
          {t('transactions.account')}
        </span>
        <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
          {label}
        </span>
      </div>
      <div className="flex w-full items-start justify-between gap-3 font-poppins text-sm text-white">
        <span className="shrink-0 text-gray-300">{t('send.balance')}</span>
        <div className="flex min-w-0 flex-wrap justify-end gap-1 text-right">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {balances[getNetworkChain(isBitcoinBased)]}
          </span>
          <span className="text-brand-blue200">{currency.toUpperCase()}</span>
        </div>
      </div>
      <div className="flex w-full items-start justify-between gap-3 font-poppins text-sm text-white">
        <span className="shrink-0 text-gray-300">
          {t('transactions.origin')}
        </span>
        <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
          {host}
        </span>
      </div>
    </div>
  );

  const DataSignature = () => {
    // Extract parameters from data object (filter out non-numeric properties)
    const parameters = Object.keys(data)
      .filter((key) => !isNaN(Number(key)))
      .map((key) => data[key]);
    const personalSignParams =
      data.eventName === 'personal_sign'
        ? getPersonalSignParams(data)
        : undefined;
    const typedData =
      data.eventName === 'eth_signTypedData_v3' ||
      data.eventName === 'eth_signTypedData_v4'
        ? typedOrderRequest?.modernData
        : null;

    return (
      <div className="w-full space-y-4">
        {/* Show raw parameters for all signature types */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
              {t('send.rawParameters')}
            </span>
          </div>
          <div className="space-y-2">
            {parameters.map((param: any, index: number) => (
              <div key={index} className="flex flex-col">
                <span className="text-xs text-gray-400">params[{index}]:</span>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words">
                  {typeof param === 'string' ? param : JSON.stringify(param)}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* Show interpreted data for typed data signatures */}
        {(data.eventName === 'eth_signTypedData_v3' ||
          data.eventName === 'eth_signTypedData_v4') && (
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                {t('send.structuredData')}
              </span>
            </div>
            <div className="max-h-80 overflow-auto">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                {/* Full compact data avoids whitespace expansion at depth. */}
                {JSON.stringify(typedData)}
              </pre>
            </div>
          </div>
        )}

        {/* Show parameter interpretation for eth_sign and personal_sign */}
        {(data.eventName === 'eth_sign' ||
          data.eventName === 'personal_sign') && (
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="min-w-0 [overflow-wrap:anywhere] text-xs font-medium text-gray-300 uppercase tracking-wide [@media(max-width:360px)]:tracking-[0.2em]">
                {t('send.parameterInterpretation')}
              </span>
            </div>
            <div className="space-y-2 text-xs text-gray-300">
              {data.eventName === 'eth_sign' ? (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">
                      {t('send.addressMatch')}
                    </span>
                    {data[0] === activeAccount.address ||
                    data[1] === activeAccount.address ? (
                      <>
                        <svg
                          className="w-4 h-4 text-green-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-green-400 font-medium">
                          {t('send.match')}
                        </span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4 text-red-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-red-400 font-medium">
                          {t('send.mismatch')}
                        </span>
                      </>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-400">
                      {t('send.interpretedMessage')}
                    </span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address
                        ? data[1]
                        : data[1] === activeAccount.address
                        ? data[0]
                        : data[0]}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-gray-400">{t('send.expected')}</span>
                    <span>{t('send.expectedFormat')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">
                      {t('send.actualParams')}
                    </span>
                    <span className="font-mono break-words">
                      [{parameters.map((p) => `"${p}"`).join(', ')}]
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.address')}</span>
                    <span className="font-mono break-all">
                      {personalSignParams?.address}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.message')}: </span>
                    <span className="font-mono break-words">
                      {personalSignParams?.message}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const SignatureDetails = () => (
    <div className="space-y-3">
      {data.eventName === 'eth_signTypedData' &&
        typedOrderRequest?.legacyFields?.map((item: any, number: number) => (
          <div
            key={number}
            className="flex min-w-0 w-full flex-col gap-1 font-poppins text-sm text-white"
          >
            <span className="min-w-0 max-w-full whitespace-pre-wrap text-gray-300 [overflow-wrap:anywhere]">
              {item?.name}
            </span>
            <span className="min-w-0 max-w-full whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">
              {typeof item.value === 'object'
                ? JSON.stringify(item.value)
                : String(item.value)}
            </span>
          </div>
        ))}
    </div>
  );

  return (
    <>
      <ErrorModal
        show={Boolean(errorMsg || typedOrderRequest?.error)}
        onClose={handleClose}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || typedOrderRequest?.error || '...'}
        buttonText={t('buttons.ok')}
      />

      <WarningModal
        show={blacklistWarning.show}
        onClose={() =>
          setBlacklistWarning((prev) => ({ ...prev, show: false }))
        }
        title={
          blacklistWarning.severity === 'critical'
            ? t('blacklist.blacklistCriticalWarning')
            : t('blacklist.blacklistHighRisk')
        }
        description={(() => {
          // Provide specific warnings based on field type
          if (blacklistWarning.fieldName === 'spender') {
            return t('blacklist.permitSpenderWarning');
          }
          if (blacklistWarning.fieldName === 'maker') {
            return t('blacklist.makerWarning');
          }
          if (blacklistWarning.fieldName === 'taker') {
            return t('blacklist.takerWarning');
          }
          if (blacklistWarning.fieldName === 'offerer') {
            return t('blacklist.offererWarning');
          }
          if (blacklistWarning.fieldName === 'zone') {
            return t('blacklist.zoneWarning');
          }
          if (blacklistWarning.fieldName?.startsWith('fees[')) {
            return t('blacklist.feeRecipientWarning');
          }
          if (blacklistWarning.fieldName?.startsWith('consideration[')) {
            return t('blacklist.considerationRecipientWarning');
          }

          // Default message for other fields
          return t('blacklist.typedDataAddressWarning', {
            field: blacklistWarning.fieldName,
          });
        })()}
        warningMessage={`${
          blacklistWarning.reason || t('blacklist.blacklistDefaultWarning')
        }\n\n${t('send.address')}${blacklistWarning.address}\n\n${t(
          'blacklist.blacklistWarningDiscouraged'
        )}`}
        buttonText={t('settings.gotIt')}
      />

      {initialLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingComponent />
        </div>
      ) : (
        <div className="flex flex-col w-full h-screen">
          {/* Main scrollable content area */}
          <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
            {/* Header Section */}
            <div className="flex flex-col w-full items-center justify-center mb-8 px-6 py-8">
              <div className="w-16 h-16 relative p-4 mb-6 rounded-full bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
                <img
                  className="absolute inset-0 w-full h-full p-4"
                  src="/assets/all_assets/signature.svg"
                  alt=""
                />
              </div>
              <h1 className="text-center text-xl font-semibold text-white mb-2">
                {getActionType()}
              </h1>
              <p className="text-sm text-gray-300 text-center mb-1">
                {getMessageDescription()}
              </p>
              <p className="w-full min-w-0 text-center text-xs text-gray-400 [overflow-wrap:anywhere]">
                {t('send.from')} <span className="font-medium">{host}</span>
              </p>
              {activeAccount.isSmartAccount && (
                <div className="mt-4 rounded-lg border border-brand-blue500 bg-brand-blue500 bg-opacity-10 px-4 py-3 text-center">
                  <p className="text-xs font-medium text-brand-blue200">
                    {t(
                      'send.smartAccountSignatureNotice',
                      'Smart account signature'
                    )}
                  </p>
                  <p className="mt-1 text-xs text-gray-300">
                    {t(
                      'send.smartAccountSignatureNoticeDescription',
                      'Pali will ask the active authenticator driver to authorize this request.'
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Message Preview Section */}
            {displayMessage && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                      {t('send.message')}
                    </span>
                    <IconButton
                      aria-label={t('buttons.copy')}
                      className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center"
                      onClick={() => copy(displayMessage)}
                    >
                      <Icon
                        name="copy"
                        className="text-brand-white hover:text-brand-blue100"
                        size={12}
                      />
                    </IconButton>
                  </div>
                  <div className="max-h-24 overflow-auto">
                    <p className="text-sm text-white font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {displayMessage}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Security Warning */}
            {blacklistedAddresses.length > 0 && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div
                  className={`rounded-lg overflow-hidden ${
                    blacklistedAddresses.some(
                      (addr) =>
                        addr.severity === 'critical' || addr.severity === 'high'
                    )
                      ? 'bg-red-900/10 border border-red-500/50'
                      : 'bg-yellow-900/10 border border-yellow-500/50'
                  }`}
                >
                  {/* Warning Header */}
                  <div
                    className={`px-4 py-3 flex items-center gap-2 ${
                      blacklistedAddresses.some(
                        (addr) =>
                          addr.severity === 'critical' ||
                          addr.severity === 'high'
                      )
                        ? 'bg-red-900/30'
                        : 'bg-yellow-900/30'
                    }`}
                  >
                    <Icon
                      name="warning"
                      className={`w-5 h-5 ${
                        blacklistedAddresses.some(
                          (addr) =>
                            addr.severity === 'critical' ||
                            addr.severity === 'high'
                        )
                          ? 'text-red-400'
                          : 'text-yellow-400'
                      }`}
                    />
                    <span className="text-sm font-semibold text-white">
                      {blacklistedAddresses.some(
                        (addr) =>
                          addr.severity === 'critical' ||
                          addr.severity === 'high'
                      )
                        ? t('blacklist.blacklistCriticalWarning')
                        : t('blacklist.blacklistHighRisk')}
                    </span>
                  </div>

                  {/* Warning Content */}
                  <div className="p-4 space-y-3">
                    {blacklistedAddresses.map((item, index) => (
                      <div key={index} className="space-y-1">
                        <div className="text-xs font-medium text-gray-300">
                          {(() => {
                            // Handle special field descriptions
                            if (item.field === 'spender')
                              return t('blacklist.spenderDescription');
                            if (item.field === 'maker')
                              return t('blacklist.makerDescription');
                            if (item.field === 'taker')
                              return t('blacklist.takerDescription');
                            if (item.field === 'offerer')
                              return t('blacklist.offererDescription');
                            if (item.field === 'zone')
                              return t('blacklist.zoneDescription');
                            if (item.field.startsWith('fees['))
                              return t('blacklist.feeRecipientDescription');
                            if (item.field.startsWith('consideration['))
                              return t(
                                'blacklist.considerationRecipientDescription'
                              );
                            if (item.field === 'to')
                              return t('blacklist.toDescription');
                            if (item.field === 'recipient')
                              return t('blacklist.recipientDescription');
                            if (item.field === 'operator')
                              return t('blacklist.operatorDescription');
                            if (item.field === 'approved')
                              return t('blacklist.approvedDescription');
                            if (item.field === 'delegate')
                              return t('blacklist.delegateDescription');

                            // Default fallback
                            return t('blacklist.fieldAddress', {
                              field:
                                item.field.charAt(0).toUpperCase() +
                                item.field.slice(1),
                              interpolation: { escapeValue: false },
                            });
                          })()}
                        </div>
                        <div className="font-mono text-xs text-white bg-black/30 rounded px-2 py-1 break-all">
                          {item.address}
                        </div>
                        {item.reason && (
                          <div className="text-xs text-gray-400 mt-1">
                            <span className="font-medium">
                              {t('blacklist.reason')}:
                            </span>{' '}
                            {item.reason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Warning Section for eth_sign */}
            {data.eventName === 'eth_sign' && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 mt-0.5 flex-shrink-0">
                      <svg
                        className="w-full h-full text-red-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-300 mb-1">
                        {t('send.potentiallyDangerous')}
                      </p>
                      <p className="text-xs text-red-200">
                        {t('send.dangerousSignatureWarning', { host })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {typedOrderRequest?.review && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <TypedOrderReview review={typedOrderRequest.review} />
              </div>
            )}

            {/* Tabs Section */}
            <div className="flex flex-col w-full max-w-md mx-auto mb-8 px-6">
              <div className="flex gap-1 mb-4">
                {tabLabel.map((name, index) => (
                  <button
                    key={index}
                    onClick={() => setState(name)}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      name === state
                        ? 'bg-brand-blue600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {t(name === 'Details' ? 'send.details' : 'send.data')}
                  </button>
                ))}
              </div>
              <div className="bg-gray-800 rounded-lg p-4 min-h-[120px]">
                {state === 'Details' ? (
                  <>
                    <AccountDetailsSignature />
                    <SignatureDetails />
                  </>
                ) : (
                  <DataSignature />
                )}
              </div>
            </div>
          </div>

          {/* Fixed button container at bottom */}
          <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <DeviceWaitingBanner account={activeAccount} show={loading} />
            <PqSigningOverlay
              expectedSeconds={90}
              show={isPqSigning}
              subtitle={t('settings.slhDsaSigningOverlayDescription')}
              title={t('settings.slhDsaSigningInProgress')}
              warningSeconds={180}
            />
            <div className="flex gap-3 justify-center">
              <Button
                variant="secondary"
                type="button"
                disabled={loading}
                onClick={handleClose}
              >
                {t('buttons.cancel')}
              </Button>

              <Button
                variant="primary"
                type="submit"
                disabled={
                  confirmed ||
                  Boolean(personalSignReview?.error || typedOrderRequest?.error)
                }
                loading={loading}
                onClick={onSubmit}
              >
                {t('buttons.confirm')}
              </Button>
            </div>
          </ToastActionFooter>
        </div>
      )}
    </>
  );
};

export default EthSign;
