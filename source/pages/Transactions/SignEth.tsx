import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
  IconButton,
  Icon,
  WarningModal,
} from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { IBlacklistCheckResult } from 'types/security';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { handleTransactionError } from 'utils/errorHandling';
import { getNetworkChain } from 'utils/network';

interface ISign {
  send?: boolean;
}
const EthSign: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<string>('Details');
  const [errorMsg, setErrorMsg] = useState('');
  const [message, setMessage] = useState<string>('');
  const [blacklistWarning, setBlacklistWarning] = useState<{
    address?: string;
    fieldName?: string;
    reason?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    show: boolean;
  }>({ show: false });
  const [blacklistedAddresses, setBlacklistedAddresses] = useState<
    Array<{
      address: string;
      field: string;
      reason?: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
    }>
  >([]);
  const [hasCheckedBlacklist, setHasCheckedBlacklist] = useState(false);

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

  const onSubmit = async () => {
    setLoading(true);

    // Safety check: signing is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg(t('send.messageSigningNotAvailable'));
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      return;
    }

    try {
      let response = '';
      const type = data.eventName;
      if (data.eventName === 'eth_sign')
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'ethSign'],
          [data],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : 10000 // Default 10 seconds for regular wallets
        )) as string;
      else if (data.eventName === 'personal_sign')
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
          [data],
          activeAccount.isTrezorWallet || activeAccount.isLedgerWallet
            ? 300000 // 5 minutes timeout for hardware wallet operations
            : 10000 // Default 10 seconds for regular wallets
        )) as string;
      else {
        let typedData;
        if (
          typeof data[0] === 'string' &&
          data[0].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[1];
        } else if (
          typeof data[1] === 'string' &&
          data[1].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[0];
        } else {
          throw { message: t('send.signingForWrongAddress') };
        }
        if (typeof typedData === 'string') typedData = JSON.parse(typedData);
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
      setConfirmed(true);
      setLoading(false);

      // Dispatch event right before closing
      dispatchBackgroundEvent(`${type}.${host}`, response);
      window.close();
    } catch (error: any) {
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
        setErrorMsg(error.message);
      }

      setLoading(false);
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
    }
  };

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
    if (data.eventName === 'personal_sign') {
      let msg = '';
      let requestedAddress = '';

      // Standard parameter order for personal_sign is [message, address]
      // Some dapps may send [address, message] for compatibility
      // Check if first param looks like an Ethereum address
      const isFirstParamAddress =
        data[0] &&
        typeof data[0] === 'string' &&
        data[0].startsWith('0x') &&
        data[0].length === 42;

      if (isFirstParamAddress) {
        // Non-standard order: [address, message]
        requestedAddress = data[0];
        msg = data[1] || '';
      } else {
        // Standard order: [message, address]
        msg = data[0] || '';
        requestedAddress = data[1] || '';
      }

      // Validate that the requested address matches the active account
      if (
        requestedAddress &&
        requestedAddress.toLowerCase() !== activeAccount.address.toLowerCase()
      ) {
        setErrorMsg(t('send.signingForWrongAddress'));
        return;
      }

      // Check if the message is hex encoded UTF-8 text or just a string starting with 0x
      if (msg.startsWith('0x') && msg.length > 2) {
        // Try to parse as hex, but only if it's likely to be encoded text
        // Ethereum addresses are 42 characters (0x + 40 hex), so skip those
        if (msg.length === 42) {
          // This is likely an Ethereum address, show as-is
          setMessage(msg);
        } else {
          // This might be hex-encoded text, try to parse it
          controllerEmitter(
            ['wallet', 'ethereumTransaction', 'parsePersonalMessage'],
            [msg]
          )
            .then((res: string) => {
              // Only use parsed result if it contains readable text
              if (res && /^[\x20-\x7E\s]*$/.test(res)) {
                setMessage(res);

                // Check for SIWE (Sign-In With Ethereum) messages
                // These messages contain an embedded address that should match the signing account
                const siwePattern =
                  /wants you to sign in with your Ethereum account:\s*\n\s*(0x[a-fA-F0-9]{40})/i;
                const match = res.match(siwePattern);

                if (match && match[1]) {
                  const embeddedAddress = match[1];
                  if (
                    embeddedAddress.toLowerCase() !==
                    activeAccount.address.toLowerCase()
                  ) {
                    setErrorMsg(t('send.signingForWrongAddress'));
                  }
                }

                // Check if domain in SIWE message matches the requesting domain
                const domainPattern = /^([^\s]+)\s+wants you to sign in/i;
                const domainMatch = res.match(domainPattern);

                if (domainMatch && domainMatch[1]) {
                  const messageDomain = domainMatch[1];
                  if (messageDomain.toLowerCase() !== host.toLowerCase()) {
                    setErrorMsg(t('send.suspiciousSignInRequest'));
                  }
                }
              } else {
                // Parsed result is not readable text, show original
                setMessage(msg);
              }
            })
            .catch(() => {
              // If parsing fails, show the original message
              setMessage(msg);
            });
        }
      } else {
        // Message is plain text, show it directly
        setMessage(msg);

        // Check for SIWE messages in plain text too
        const siwePattern =
          /wants you to sign in with your Ethereum account:\s*\n\s*(0x[a-fA-F0-9]{40})/i;
        const match = msg.match(siwePattern);

        if (match && match[1]) {
          const embeddedAddress = match[1];
          if (
            embeddedAddress.toLowerCase() !==
            activeAccount.address.toLowerCase()
          ) {
            setErrorMsg(t('send.signingForWrongAddress'));
          }
        }

        // Check if domain in SIWE message matches the requesting domain
        const domainPattern = /^([^\s]+)\s+wants you to sign in/i;
        const domainMatch = msg.match(domainPattern);

        if (domainMatch && domainMatch[1]) {
          const messageDomain = domainMatch[1];
          if (messageDomain.toLowerCase() !== host.toLowerCase()) {
            setErrorMsg(
              t('send.suspiciousSignInRequest') ||
                "The site making the request is not the site you're signing into. This could be an attempt to steal your login credentials."
            );
          }
        }
      }
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

  // Reset the blacklist check flag when data changes
  useEffect(() => {
    setHasCheckedBlacklist(false);
    setBlacklistedAddresses([]);
    setBlacklistWarning({ show: false });
  }, [data.eventName]);

  // Check for malicious addresses in EIP-712 permit messages
  useEffect(() => {
    const checkPermitBlacklist = async () => {
      // Only check for typed data v3 and v4
      if (
        data.eventName !== 'eth_signTypedData_v3' &&
        data.eventName !== 'eth_signTypedData_v4'
      ) {
        return;
      }

      // Don't check again if we've already checked for this data
      if (hasCheckedBlacklist) {
        return;
      }

      try {
        // Mark as checked before starting the async operation
        setHasCheckedBlacklist(true);
        // Get the typed data
        let typedData;
        if (
          typeof data[0] === 'string' &&
          data[0].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[1];
        } else if (
          typeof data[1] === 'string' &&
          data[1].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[0];
        } else {
          return;
        }

        // Parse the typed data if it's a string
        if (typeof typedData === 'string') {
          typedData = JSON.parse(typedData);
        }

        // Check if this is a permit message
        const primaryType = typedData.primaryType;
        const typedMessage = typedData.message;
        const foundBlacklisted: typeof blacklistedAddresses = [];
        let showModal = false;

        if (primaryType === 'Permit' && typedMessage) {
          // Check the spender address
          if (typedMessage.spender) {
            const result = (await controllerEmitter(
              ['wallet', 'checkAddressBlacklist'],
              [typedMessage.spender]
            )) as IBlacklistCheckResult;
            if (result.isBlacklisted) {
              foundBlacklisted.push({
                field: 'spender',
                address: typedMessage.spender,
                reason: result.reason,
                severity: result.severity,
              });

              // Show modal for high/critical severity
              if (
                result.severity === 'high' ||
                result.severity === 'critical'
              ) {
                showModal = true;
                setBlacklistWarning({
                  show: true,
                  address: typedMessage.spender,
                  reason: result.reason,
                  severity: result.severity,
                  fieldName: 'spender',
                });
              }
            }
          }
        }

        // Check for ERC721Order (NFT trade orders)
        if (primaryType === 'ERC721Order' && typedMessage) {
          console.log('[Blacklist Check] Checking ERC721Order');
          // Check maker (creator of the order)
          if (
            typedMessage.maker &&
            typeof typedMessage.maker === 'string' &&
            typedMessage.maker.startsWith('0x')
          ) {
            const result = (await controllerEmitter(
              ['wallet', 'checkAddressBlacklist'],
              [typedMessage.maker]
            )) as IBlacklistCheckResult;
            if (result.isBlacklisted) {
              foundBlacklisted.push({
                field: 'maker',
                address: typedMessage.maker,
                reason: result.reason,
                severity: result.severity,
              });

              if (
                !showModal &&
                (result.severity === 'high' || result.severity === 'critical')
              ) {
                showModal = true;
                setBlacklistWarning({
                  show: true,
                  address: typedMessage.maker,
                  reason: result.reason,
                  severity: result.severity,
                  fieldName: 'maker',
                });
              }
            }
          }

          // Check taker (if specified and not zero address)
          if (
            typedMessage.taker &&
            typeof typedMessage.taker === 'string' &&
            typedMessage.taker.startsWith('0x') &&
            typedMessage.taker !== '0x0000000000000000000000000000000000000000'
          ) {
            const result = (await controllerEmitter(
              ['wallet', 'checkAddressBlacklist'],
              [typedMessage.taker]
            )) as IBlacklistCheckResult;
            if (result.isBlacklisted) {
              foundBlacklisted.push({
                field: 'taker',
                address: typedMessage.taker,
                reason: result.reason,
                severity: result.severity,
              });

              if (
                !showModal &&
                (result.severity === 'high' || result.severity === 'critical')
              ) {
                showModal = true;
                setBlacklistWarning({
                  show: true,
                  address: typedMessage.taker,
                  reason: result.reason,
                  severity: result.severity,
                  fieldName: 'taker',
                });
              }
            }
          }

          // Check fee recipients if fees array exists
          if (typedMessage.fees && Array.isArray(typedMessage.fees)) {
            for (let i = 0; i < typedMessage.fees.length; i++) {
              const fee = typedMessage.fees[i];
              if (
                fee &&
                fee.recipient &&
                typeof fee.recipient === 'string' &&
                fee.recipient.startsWith('0x')
              ) {
                const result = (await controllerEmitter(
                  ['wallet', 'checkAddressBlacklist'],
                  [fee.recipient]
                )) as IBlacklistCheckResult;
                if (result.isBlacklisted) {
                  foundBlacklisted.push({
                    field: `fees[${i}].recipient`,
                    address: fee.recipient,
                    reason: result.reason,
                    severity: result.severity,
                  });

                  if (
                    !showModal &&
                    (result.severity === 'high' ||
                      result.severity === 'critical')
                  ) {
                    showModal = true;
                    setBlacklistWarning({
                      show: true,
                      address: fee.recipient,
                      reason: result.reason,
                      severity: result.severity,
                      fieldName: `fees[${i}].recipient`,
                    });
                  }
                }
              }
            }
          }
        }

        // Check for OrderComponents (Seaport/OpenSea orders)
        if (primaryType === 'OrderComponents' && typedMessage) {
          // Check offerer (creator of the order)
          if (
            typedMessage.offerer &&
            typeof typedMessage.offerer === 'string' &&
            typedMessage.offerer.startsWith('0x')
          ) {
            const result = (await controllerEmitter(
              ['wallet', 'checkAddressBlacklist'],
              [typedMessage.offerer]
            )) as IBlacklistCheckResult;
            if (result.isBlacklisted) {
              foundBlacklisted.push({
                field: 'offerer',
                address: typedMessage.offerer,
                reason: result.reason,
                severity: result.severity,
              });

              if (
                !showModal &&
                (result.severity === 'high' || result.severity === 'critical')
              ) {
                showModal = true;
                setBlacklistWarning({
                  show: true,
                  address: typedMessage.offerer,
                  reason: result.reason,
                  severity: result.severity,
                  fieldName: 'offerer',
                });
              }
            }
          }

          // Check zone (additional validation contract)
          if (
            typedMessage.zone &&
            typeof typedMessage.zone === 'string' &&
            typedMessage.zone.startsWith('0x') &&
            typedMessage.zone !== '0x0000000000000000000000000000000000000000'
          ) {
            const result = (await controllerEmitter(
              ['wallet', 'checkAddressBlacklist'],
              [typedMessage.zone]
            )) as IBlacklistCheckResult;
            if (result.isBlacklisted) {
              foundBlacklisted.push({
                field: 'zone',
                address: typedMessage.zone,
                reason: result.reason,
                severity: result.severity,
              });

              if (
                !showModal &&
                (result.severity === 'high' || result.severity === 'critical')
              ) {
                showModal = true;
                setBlacklistWarning({
                  show: true,
                  address: typedMessage.zone,
                  reason: result.reason,
                  severity: result.severity,
                  fieldName: 'zone',
                });
              }
            }
          }

          // Check consideration array (items required in return, includes recipient addresses)
          if (
            typedMessage.consideration &&
            Array.isArray(typedMessage.consideration)
          ) {
            for (let i = 0; i < typedMessage.consideration.length; i++) {
              const item = typedMessage.consideration[i];
              if (
                item &&
                item.recipient &&
                typeof item.recipient === 'string' &&
                item.recipient.startsWith('0x')
              ) {
                const result = (await controllerEmitter(
                  ['wallet', 'checkAddressBlacklist'],
                  [item.recipient]
                )) as IBlacklistCheckResult;
                if (result.isBlacklisted) {
                  foundBlacklisted.push({
                    field: `consideration[${i}].recipient`,
                    address: item.recipient,
                    reason: result.reason,
                    severity: result.severity,
                  });

                  if (
                    !showModal &&
                    (result.severity === 'high' ||
                      result.severity === 'critical')
                  ) {
                    showModal = true;
                    setBlacklistWarning({
                      show: true,
                      address: item.recipient,
                      reason: result.reason,
                      severity: result.severity,
                      fieldName: `consideration[${i}].recipient`,
                    });
                  }
                }
              }
            }
          }
        }

        // Check for other potentially dangerous addresses in typed data
        if (message) {
          // Check common fields that might contain addresses that receive funds/permissions
          const addressFields = [
            'to',
            'recipient',
            'operator',
            'approved',
            'delegate',
          ];

          for (const field of addressFields) {
            if (
              message[field] &&
              typeof message[field] === 'string' &&
              message[field].startsWith('0x')
            ) {
              const result = (await controllerEmitter(
                ['wallet', 'checkAddressBlacklist'],
                [message[field]]
              )) as IBlacklistCheckResult;
              if (result.isBlacklisted) {
                foundBlacklisted.push({
                  field,
                  address: message[field],
                  reason: result.reason,
                  severity: result.severity,
                });

                // Show modal for the first high/critical severity
                if (
                  !showModal &&
                  (result.severity === 'high' || result.severity === 'critical')
                ) {
                  showModal = true;
                  setBlacklistWarning({
                    show: true,
                    address: message[field],
                    reason: result.reason,
                    severity: result.severity,
                    fieldName: field,
                  });
                }
              }
            }
          }
        }

        // Update the list of all blacklisted addresses found
        setBlacklistedAddresses(foundBlacklisted);
      } catch (error) {
        console.error('Error checking permit blacklist:', error);
      }
    };

    checkPermitBlacklist();
  }, [data, address, hasCheckedBlacklist]);

  const AccountDetailsSignature = () => (
    <div className="space-y-3">
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('transactions.account')}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('send.balance')}</span>
        <div className="flex gap-1">
          <span className="font-medium">
            {balances[getNetworkChain(isBitcoinBased)]}
          </span>
          <span className="text-brand-blue200">{currency.toUpperCase()}</span>
        </div>
      </div>
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('transactions.origin')}</span>
        <span className="font-medium break-all">{host}</span>
      </div>
    </div>
  );

  const DataSignature = () => {
    // Extract parameters from data object (filter out non-numeric properties)
    const parameters = Object.keys(data)
      .filter((key) => !isNaN(Number(key)))
      .map((key) => data[key]);

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
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                  {typeof param === 'string'
                    ? param
                    : JSON.stringify(param, null, 2)}
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
                {JSON.stringify(JSON.parse(data[1]), null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Show parameter interpretation for eth_sign and personal_sign */}
        {(data.eventName === 'eth_sign' ||
          data.eventName === 'personal_sign') && (
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
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
                    <span className="font-mono break-all">
                      [{parameters.map((p) => `"${p}"`).join(', ')}]
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.address')}</span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address ? data[0] : data[1]}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.message')}: </span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address ? data[1] : data[0]}
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
        data[0].map((item: any, number: number) => (
          <div
            key={number}
            className="flex flex-row justify-between w-full font-poppins text-sm text-white"
          >
            <span className="text-gray-300">{item?.name}</span>
            <span className="font-medium break-all">{item?.value}</span>
          </div>
        ))}
    </div>
  );

  return (
    <>
      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
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
        }\n\nAddress: ${blacklistWarning.address}\n\n${t(
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
                  alt="Signature"
                />
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">
                {getActionType()}
              </h1>
              <p className="text-sm text-gray-300 text-center mb-1">
                {getMessageDescription()}
              </p>
              <p className="text-xs text-gray-400 text-center">
                from <span className="font-medium">{host}</span>
              </p>
            </div>

            {/* Message Preview Section */}
            {message && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                      {t('send.message')}
                    </span>
                    <IconButton onClick={() => copy(message)}>
                      <Icon
                        name="copy"
                        className="text-brand-white hover:text-fields-input-borderfocus"
                        size={12}
                      />
                    </IconButton>
                  </div>
                  <div className="max-h-24 overflow-auto">
                    <p className="text-sm text-white font-mono break-all">
                      {message}
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
                              return 'Spender address (can access your tokens)';
                            if (item.field === 'maker')
                              return 'Maker address (order creator)';
                            if (item.field === 'taker')
                              return 'Taker address (who can fulfill this order)';
                            if (item.field === 'offerer')
                              return 'Offerer address (Seaport order creator)';
                            if (item.field === 'zone')
                              return 'Zone address (additional validation contract)';
                            if (item.field.startsWith('fees['))
                              return 'Fee recipient address';
                            if (item.field.startsWith('consideration['))
                              return 'Consideration recipient (who receives assets)';
                            if (item.field === 'to')
                              return 'To address (recipient)';
                            if (item.field === 'recipient')
                              return 'Recipient address';
                            if (item.field === 'operator')
                              return 'Operator address (can manage assets)';
                            if (item.field === 'approved')
                              return 'Approved address';
                            if (item.field === 'delegate')
                              return 'Delegate address';

                            // Default fallback
                            return `${
                              item.field.charAt(0).toUpperCase() +
                              item.field.slice(1)
                            } address`;
                          })()}
                        </div>
                        <div className="font-mono text-xs text-white bg-black/30 rounded px-2 py-1 break-all">
                          {item.address}
                        </div>
                        {item.reason && (
                          <div className="text-xs text-gray-400 mt-1">
                            <span className="font-medium">Reason:</span>{' '}
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
                    {name}
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
          <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <div className="flex gap-3 justify-center">
              <SecondaryButton
                type="button"
                disabled={loading}
                onClick={window.close}
              >
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="submit"
                disabled={confirmed}
                loading={loading}
                onClick={onSubmit}
              >
                {t('buttons.confirm')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default EthSign;
