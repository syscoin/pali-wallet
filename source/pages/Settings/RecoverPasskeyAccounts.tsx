import { getAddress } from '@ethersproject/address';
import { Form, Input } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { DropdownArrowSvg } from 'components/Icon/Icon';
import { Card, Icon, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { formatFullPrecisionBalance, ellipsis } from 'utils/index';
import { navigateBack } from 'utils/navigationState';
import {
  bytesToHex,
  createPasskeyCredential,
  getDiscoverablePasskeyAssertion,
  getPasskeyAssertion,
  passkeyAssertionToProof,
  toPasskeyRecoveryIdentityFromPublicKey,
} from 'utils/passkey';
import type { PasskeyAssertionResult } from 'utils/passkey';

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pb-36 text-left';

const detailLabel = (labelWithValue: string) =>
  labelWithValue.replace(/\s*[:：]\s*$/, '').trim();

type RecoveryCandidate = {
  address: string;
  balance: string;
  currency: string;
  sponsor?: {
    mode?: string;
    signer?: string;
    url?: string;
  } | null;
  txCount?: number;
};

type RecoveryCredential = {
  backupStatus?: string;
  credentialId: string;
  credentialIdHash: string;
  publicKeyCandidates: PasskeyAssertionResult['publicKeyCandidates'];
  verificationHash: string;
  verificationProof: ReturnType<typeof passkeyAssertionToProof>;
};

type GuardianReplacementCredential = {
  backupStatus?: string;
  credentialId: string;
  credentialIdHash: string;
};

type GuardianRecoveryStatus = {
  delay: string;
  exists: boolean;
  guardianCount: string;
  guardians: string[];
  pending: {
    credentialIdHash: string;
    readyAt: string;
    recoveryNonce: string;
  } | null;
  threshold: string;
} | null;

const guardianReplacementCredentialKey = (account: string) =>
  `pali-passkey-guardian-replacement:${account.toLowerCase()}`;

const RecoverPasskeyAccounts = () => {
  const { t } = useTranslation();
  const { alert, useCopyClipboard } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, copy] = useCopyClipboard();

  const [address, setAddress] = useState<string | undefined>();
  const [accountName, setAccountName] = useState<string>('');
  const [recoveredCount, setRecoveredCount] = useState<number>(0);
  const [candidates, setCandidates] = useState<RecoveryCandidate[]>([]);
  const [existingCount, setExistingCount] = useState<number>(0);
  const [skippedCount, setSkippedCount] = useState<number>(0);
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(
    new Set()
  );
  const [expandedAddresses, setExpandedAddresses] = useState<Set<string>>(
    new Set()
  );
  const [recoveryCredential, setRecoveryCredential] =
    useState<RecoveryCredential | null>(null);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [recoveryAccountAddress, setRecoveryAccountAddress] =
    useState<string>('');
  const [guardianLoading, setGuardianLoading] = useState<boolean>(false);
  const [guardianStep, setGuardianStep] = useState<string>('');
  const [guardianStatus, setGuardianStatus] =
    useState<GuardianRecoveryStatus>(null);
  const [guardianStatusLoading, setGuardianStatusLoading] =
    useState<boolean>(false);
  const [guardianReplacementCredential, setGuardianReplacementCredential] =
    useState<GuardianReplacementCredential | null>(null);
  const loading = discovering || importing || guardianLoading;
  const selectedCount = selectedAddresses.size;
  const allSelected =
    candidates.length > 0 && selectedAddresses.size === candidates.length;
  const isImportDisabled = loading || selectedCount === 0;

  const normalizeEvmAddress = (value: string) => {
    try {
      return value.trim() ? getAddress(value.trim()).toLowerCase() : '';
    } catch {
      return '';
    }
  };

  const normalizedRecoveryAccountAddress = normalizeEvmAddress(
    recoveryAccountAddress
  );
  const recoveryAccountAddressError = (() => {
    if (!recoveryAccountAddress.trim()) return '';
    if (!normalizedRecoveryAccountAddress) {
      return t('settings.invalidPasskeyRecoveryAccountAddress');
    }
    return '';
  })();
  const isRecoveryAccountAddressValid =
    Boolean(normalizedRecoveryAccountAddress) && !recoveryAccountAddressError;
  const recoveryAccountAddressValidateStatus = recoveryAccountAddress.trim()
    ? recoveryAccountAddressError
      ? 'error'
      : 'success'
    : undefined;
  const guardianPolicyReady =
    Boolean(guardianStatus?.exists) &&
    guardianStatus?.threshold === '1' &&
    Boolean(guardianStatus.guardians?.[0]);
  const guardianRecoveryConfigured = Boolean(guardianStatus?.exists);
  const guardianRecoveryPending = Boolean(guardianStatus?.pending);
  const guardianRecoveryReady =
    Boolean(guardianStatus?.pending?.readyAt) &&
    Number(guardianStatus?.pending?.readyAt) <= Math.floor(Date.now() / 1000);
  const isStartGuardianRecoveryDisabled =
    loading ||
    guardianStatusLoading ||
    !isRecoveryAccountAddressValid ||
    !guardianPolicyReady ||
    guardianRecoveryPending;
  const isFinalizeGuardianRecoveryDisabled =
    loading ||
    guardianStatusLoading ||
    !isRecoveryAccountAddressValid ||
    !guardianRecoveryPending ||
    !guardianRecoveryReady;

  const recoveryStatus = useMemo(() => {
    if (discovering) return t('settings.passkeyRecoveryDiscovering');
    if (importing) return t('settings.passkeyRecoveryImporting');
    if (candidates.length > 0) {
      return t('settings.passkeyRecoveryReady', {
        count: candidates.length,
      });
    }
    return t('settings.recoverPasskeyAccountsDescription');
  }, [candidates.length, discovering, importing, t]);

  useEffect(() => {
    if (!copied) return;

    alert.info(t('components.copied'));
  }, [copied, alert, t]);

  useEffect(() => {
    let cancelled = false;
    setGuardianStatus(null);
    if (!isRecoveryAccountAddressValid || !normalizedRecoveryAccountAddress) {
      return () => {
        cancelled = true;
      };
    }

    setGuardianStatusLoading(true);
    controllerEmitter(
      ['wallet', 'getPasskeyGuardianRecoveryStatus'],
      [{ account: getAddress(normalizedRecoveryAccountAddress) }],
      300000
    )
      .then((status) => {
        if (!cancelled) {
          setGuardianStatus(status as GuardianRecoveryStatus);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGuardianStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGuardianStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    controllerEmitter,
    isRecoveryAccountAddressValid,
    normalizedRecoveryAccountAddress,
  ]);

  const discoverPasskeyAccounts = async () => {
    setDiscovering(true);
    setCandidates([]);
    setSelectedAddresses(new Set());
    setExpandedAddresses(new Set());
    setExistingCount(0);
    setSkippedCount(0);
    setRecoveryCredential(null);

    try {
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const verificationHash = bytesToHex(challenge);
      const assertion = await getDiscoverablePasskeyAssertion(verificationHash);
      const credentialParams = {
        backupStatus: assertion.backupStatus,
        credentialId: assertion.credentialId,
        credentialIdHash: assertion.credentialIdHash,
        publicKeyCandidates: assertion.publicKeyCandidates,
        verificationHash,
        verificationProof: passkeyAssertionToProof(assertion),
      };
      const result = (await controllerEmitter(
        ['wallet', 'previewPasskeySmartAccountRecovery'],
        [credentialParams],
        300000
      )) as any;

      const recoveredCandidates = result.candidates || [];
      setExistingCount(result.existing || 0);
      setSkippedCount(result.skipped || 0);
      setRecoveryCredential(credentialParams);
      setCandidates(recoveredCandidates);
      setSelectedAddresses(
        new Set(
          recoveredCandidates.map((candidate: RecoveryCandidate) =>
            candidate.address.toLowerCase()
          )
        )
      );

      if (recoveredCandidates.length > 0) {
        alert.success(
          t('settings.passkeyRecoveryCandidatesFound', {
            count: recoveredCandidates.length,
          })
        );
      } else {
        alert.error(t('settings.noPasskeyAccountsRecovered'));
      }
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('settings.failedToRecoverPasskey'));
      }
    } finally {
      setDiscovering(false);
    }
  };

  const importSelectedPasskeyAccounts = async () => {
    if (!recoveryCredential || selectedAddresses.size === 0) return;

    setImporting(true);
    try {
      const result = (await controllerEmitter(
        ['wallet', 'importPasskeySmartAccounts'],
        [
          {
            ...recoveryCredential,
            addresses: Array.from(selectedAddresses),
          },
        ],
        300000
      )) as any;

      if (result.recovered > 0) {
        const firstAccount = result.accounts?.[0];
        setAccountName(firstAccount?.label || t('settings.passkeyAccount'));
        setAddress(firstAccount?.address || '');
        setRecoveredCount(result.recovered);
        alert.success(
          t('settings.passkeyAccountsRecovered', {
            count: result.recovered,
          })
        );
      } else {
        alert.error(t('settings.noPasskeyAccountsImported'));
      }
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(error?.message || t('settings.failedToRecoverPasskey'));
      }
    } finally {
      setImporting(false);
    }
  };

  const toggleCandidate = (candidate: RecoveryCandidate) => {
    const normalizedAddress = candidate.address.toLowerCase();
    setSelectedAddresses((current) => {
      const next = new Set(current);
      if (next.has(normalizedAddress)) {
        next.delete(normalizedAddress);
      } else {
        next.add(normalizedAddress);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedAddresses(() => {
      if (allSelected) return new Set();
      return new Set(
        candidates.map((candidate) => candidate.address.toLowerCase())
      );
    });
  };

  const toggleDetails = (candidate: RecoveryCandidate) => {
    const normalizedAddress = candidate.address.toLowerCase();
    setExpandedAddresses((current) => {
      const next = new Set(current);
      if (next.has(normalizedAddress)) {
        next.delete(normalizedAddress);
      } else {
        next.add(normalizedAddress);
      }
      return next;
    });
  };

  const startGuardianRecovery = async () => {
    if (!isRecoveryAccountAddressValid || !normalizedRecoveryAccountAddress) {
      alert.error(
        recoveryAccountAddressError ||
          t('settings.passkeyGuardianRecoveryAccountRequired')
      );
      return;
    }
    if (!guardianPolicyReady || !guardianStatus?.guardians?.[0]) {
      alert.error(t('settings.passkeyGuardianRecoveryNotConnected'));
      return;
    }
    const account = getAddress(normalizedRecoveryAccountAddress);
    const guardian = getAddress(guardianStatus.guardians[0]);

    setGuardianLoading(true);
    try {
      setGuardianStep(t('settings.passkeyGuardianRecoveryStepPasskey'));
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const replacementPasskeyName = t(
        'settings.passkeyRecoveryReplacementName',
        {
          account,
        }
      );
      const newCredential = await createPasskeyCredential({
        accountName: replacementPasskeyName,
        challengeHex: bytesToHex(challenge),
        userDisplayName: replacementPasskeyName,
      });
      const newIdentity = toPasskeyRecoveryIdentityFromPublicKey({
        credentialIdHash: newCredential.credentialIdHash,
        originHash: newCredential.originHash,
        originLength: newCredential.originLength,
        rpIdHash: newCredential.rpIdHash,
        x: newCredential.x,
        y: newCredential.y,
      });
      const replacementCredential = {
        backupStatus: newCredential.backupStatus,
        credentialId: newCredential.credentialId,
        credentialIdHash: newCredential.credentialIdHash,
      };
      setGuardianReplacementCredential(replacementCredential);
      localStorage.setItem(
        guardianReplacementCredentialKey(account),
        JSON.stringify(replacementCredential)
      );

      setGuardianStep(t('settings.passkeyGuardianRecoveryStepSubmit'));
      await controllerEmitter(
        ['wallet', 'submitPasskeyGuardianStartRecovery'],
        [
          {
            account,
            guardian,
            newIdentity,
          },
        ],
        300000
      );
      try {
        const status = (await controllerEmitter(
          ['wallet', 'getPasskeyGuardianRecoveryStatus'],
          [{ account }],
          300000
        )) as GuardianRecoveryStatus;
        setGuardianStatus(status);
      } catch {
        // Recovery was started successfully; stale status is better than failing the flow.
      }

      alert.success(t('settings.passkeyGuardianRecoveryStarted'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        localStorage.removeItem(guardianReplacementCredentialKey(account));
        setGuardianReplacementCredential(null);
        const errorMessage = String(error?.message || '');
        const isVerboseTransactionError =
          errorMessage.length > 220 ||
          errorMessage.includes('receipt=') ||
          errorMessage.includes('logsBloom') ||
          errorMessage.includes('CALL_EXCEPTION');
        alert.error(
          isVerboseTransactionError
            ? t('settings.passkeyGuardianRecoveryStartFailed')
            : errorMessage || t('settings.passkeyGuardianRecoveryStartFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
      setGuardianStep('');
    }
  };

  const getStoredGuardianReplacementCredential = (account: string) => {
    if (guardianReplacementCredential) return guardianReplacementCredential;
    const stored = localStorage.getItem(
      guardianReplacementCredentialKey(account)
    );
    if (!stored) return null;
    try {
      return JSON.parse(stored) as GuardianReplacementCredential;
    } catch {
      return null;
    }
  };

  const importGuardianRecoveredAccount = async (
    account: string,
    requireStoredReplacement = false
  ) => {
    setGuardianStep(t('settings.passkeyGuardianRecoveryStepImport'));
    const storedReplacement = getStoredGuardianReplacementCredential(account);
    if (requireStoredReplacement && !storedReplacement) {
      throw new Error(t('settings.passkeyGuardianRecoveryFinalizeFailed'));
    }
    const verificationHash = bytesToHex(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const assertion = storedReplacement
      ? await getPasskeyAssertion(
          storedReplacement.credentialId,
          verificationHash
        )
      : await getDiscoverablePasskeyAssertion(verificationHash);
    const imported = (await controllerEmitter(
      ['wallet', 'importPasskeySmartAccountByAddress'],
      [
        {
          address: account,
          backupStatus:
            storedReplacement?.backupStatus || assertion.backupStatus,
          credentialId:
            storedReplacement?.credentialId || assertion.credentialId,
          credentialIdHash:
            storedReplacement?.credentialIdHash || assertion.credentialIdHash,
          verificationHash,
          verificationProof: passkeyAssertionToProof(assertion),
        },
      ],
      300000
    )) as any;
    localStorage.removeItem(guardianReplacementCredentialKey(account));
    setGuardianReplacementCredential(null);
    setAddress(imported.address);
    setAccountName(imported.label || t('settings.passkeyAccount'));
    setRecoveredCount(1);
  };

  const finalizeGuardianRecovery = async () => {
    if (!isRecoveryAccountAddressValid || !normalizedRecoveryAccountAddress) {
      alert.error(
        recoveryAccountAddressError ||
          t('settings.passkeyGuardianRecoveryAccountRequired')
      );
      return;
    }
    const account = getAddress(normalizedRecoveryAccountAddress);
    if (!guardianRecoveryPending) {
      alert.error(t('settings.passkeyGuardianRecoveryFinalizeFailed'));
      return;
    }
    if (!guardianRecoveryReady) {
      alert.error(t('settings.passkeyGuardianRecoveryFinalizeFailed'));
      return;
    }

    setGuardianLoading(true);
    try {
      setGuardianStep(t('settings.passkeyGuardianRecoveryStepFinalize'));
      await controllerEmitter(
        ['wallet', 'finalizePasskeyGuardianRecovery'],
        [account],
        300000
      );
      await importGuardianRecoveredAccount(account);
      alert.success(t('settings.passkeyGuardianRecoveryFinalized'));
    } catch (error: any) {
      if (
        String(error?.message || error)
          .toLowerCase()
          .includes('no guardian recovery is pending')
      ) {
        try {
          await importGuardianRecoveredAccount(account, true);
          alert.success(t('settings.passkeyGuardianRecoveryImported'));
          return;
        } catch (importError: any) {
          error = importError;
        }
      }
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          error?.message || t('settings.passkeyGuardianRecoveryFinalizeFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
      setGuardianStep('');
    }
  };

  const getPolicyLabel = (candidate: RecoveryCandidate) => {
    const mode = candidate.sponsor?.mode || 'disabled';
    return t(`settings.passkeyPolicy.${mode}.title`);
  };

  const copyValue = (
    event: React.MouseEvent<HTMLButtonElement>,
    value?: string
  ) => {
    event.stopPropagation();
    if (value) copy(value);
  };

  const renderCopyableValue = ({
    displayValue,
    label,
    value,
  }: {
    displayValue?: string;
    label: string;
    value?: string;
  }) => {
    if (!value) return null;

    return (
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-white">{label}:</span>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-brand-graylight hover:text-white"
          onClick={(event) => copyValue(event, value)}
        >
          {displayValue || value}
        </button>
        <button
          type="button"
          className="shrink-0 text-brand-graylight hover:text-white"
          aria-label={t('buttons.copy')}
          onClick={(event) => copyValue(event, value)}
        >
          <Icon name="copy" />
        </button>
      </div>
    );
  };

  return (
    <>
      {address ? (
        <CreatedAccountSuccessfully
          show={address !== ''}
          onClose={() => {
            setAddress('');
            setRecoveredCount(0);
            navigateBack(navigate, location);
          }}
          title={t('settings.passkeyAccountsRecovered', {
            count: recoveredCount,
          })}
          phraseOne={`${accountName}`}
          phraseTwo={`${address}`}
        />
      ) : (
        <>
          <div className={scrollAreaClassName}>
            <p className="text-left text-white text-sm">{recoveryStatus}</p>

            {(existingCount > 0 || skippedCount > 0) && (
              <Card type="info">
                <p className="text-brand-yellowInfo text-sm font-normal text-left">
                  {t('settings.passkeyRecoverySkippedSummary', {
                    existing: existingCount,
                    skipped: skippedCount,
                  })}
                </p>
              </Card>
            )}

            <div className="rounded-lg border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 p-4 text-xs text-brand-graylight">
              <p className="font-medium text-white">
                {t('settings.passkeyGuardianRecoveryLostTitle')}
              </p>
              <p className="mt-2 leading-5">
                {t('settings.passkeyGuardianRecoveryLostDescription')}
              </p>
              <Form.Item
                className="mb-0 mt-3"
                hasFeedback
                help={recoveryAccountAddressError}
                validateStatus={recoveryAccountAddressValidateStatus}
              >
                <Input
                  type="text"
                  className="custom-input-normal passkey-input relative"
                  disabled={loading}
                  placeholder={t(
                    'settings.passkeyGuardianRecoveryAccountAddress'
                  )}
                  value={recoveryAccountAddress}
                  onChange={(event) =>
                    setRecoveryAccountAddress(event.target.value)
                  }
                />
              </Form.Item>
              {isRecoveryAccountAddressValid && (
                <div className="mt-3 rounded-md bg-alpha-whiteAlpha100 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white">
                      {guardianStatusLoading
                        ? t('settings.passkeyRecoveryDiscovering')
                        : guardianRecoveryConfigured
                        ? t('settings.passkeyGuardianRecoveryConnectedStatus')
                        : t('settings.passkeyGuardianRecoveryNotConnected')}
                    </span>
                    {guardianStatus?.guardians?.[0] && (
                      <button
                        type="button"
                        className="truncate text-brand-graylight hover:text-white"
                        onClick={(event) =>
                          copyValue(event, guardianStatus.guardians[0])
                        }
                      >
                        {ellipsis(guardianStatus.guardians[0], 6, 4)}
                      </button>
                    )}
                  </div>
                  {guardianStatus?.pending?.readyAt && (
                    <p className="mt-2 text-brand-yellowInfo">
                      {t('settings.passkeyGuardianRecoveryReadyAt', {
                        time: new Date(
                          Number(guardianStatus.pending.readyAt) * 1000
                        ).toLocaleString(),
                      })}
                    </p>
                  )}
                </div>
              )}
              {guardianStep && (
                <p className="mt-3 text-brand-yellowInfo">{guardianStep}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isStartGuardianRecoveryDisabled}
                  onClick={startGuardianRecovery}
                >
                  {t('settings.passkeyGuardianRecoveryStart')}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isFinalizeGuardianRecoveryDisabled}
                  onClick={finalizeGuardianRecovery}
                >
                  {t('settings.passkeyGuardianRecoveryFinalize')}
                </button>
              </div>
            </div>

            {candidates.length > 0 && (
              <>
                <button
                  type="button"
                  className="self-start rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-1 text-white text-sm font-medium transition-colors hover:bg-brand-blue500 hover:bg-opacity-20 disabled:opacity-60"
                  disabled={loading}
                  onClick={toggleSelectAll}
                >
                  {allSelected
                    ? t('settings.clearSelection')
                    : t('settings.selectAll')}
                </button>

                <ul className="flex flex-col gap-3">
                  {candidates.map((candidate) => {
                    const normalizedAddress = candidate.address.toLowerCase();
                    const checked = selectedAddresses.has(normalizedAddress);
                    const isExpanded = expandedAddresses.has(normalizedAddress);
                    const hasSponsorDetails = Boolean(
                      candidate.sponsor?.signer || candidate.sponsor?.url
                    );
                    const sponsorSignerLabel = detailLabel(
                      t('settings.passkeyRecoverySponsorSigner', {
                        signer: '',
                      })
                    );
                    const sponsorUrlLabel = detailLabel(
                      t('settings.passkeyRecoverySponsorUrl', {
                        url: '',
                      })
                    );
                    return (
                      <li
                        key={candidate.address}
                        className="rounded-lg bg-alpha-whiteAlpha100 p-4"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
                            checked={checked}
                            disabled={loading}
                            onChange={() => toggleCandidate(candidate)}
                          />
                          <div className="min-w-0 flex-1 text-xs text-brand-graylight">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left font-medium text-white"
                                disabled={loading}
                                onClick={() => toggleCandidate(candidate)}
                              >
                                {ellipsis(candidate.address, 8, 6)}
                              </button>
                              <button
                                type="button"
                                className="shrink-0 text-brand-graylight hover:text-white"
                                aria-label={t('buttons.copy')}
                                onClick={(event) =>
                                  copyValue(event, candidate.address)
                                }
                              >
                                <Icon name="copy" />
                              </button>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                              <span>
                                {t('settings.passkeyRecoveryBalance', {
                                  balance: formatFullPrecisionBalance(
                                    Number(candidate.balance || 0),
                                    4
                                  ),
                                  symbol: candidate.currency?.toUpperCase?.(),
                                })}
                              </span>
                              <span className="text-right">
                                {candidate.txCount !== undefined
                                  ? t('settings.passkeyRecoveryTxCount', {
                                      count: candidate.txCount,
                                    })
                                  : t('settings.passkeyRecoveryTxCountUnknown')}
                              </span>
                              <span className="col-span-2">
                                {t('settings.passkeyRecoveryPolicy', {
                                  interpolation: { escapeValue: false },
                                  policy: getPolicyLabel(candidate),
                                })}
                              </span>
                            </div>
                            {hasSponsorDetails && (
                              <button
                                type="button"
                                className="mt-3 flex items-center gap-1 text-white font-medium disabled:opacity-60"
                                disabled={loading}
                                onClick={() => toggleDetails(candidate)}
                              >
                                {isExpanded
                                  ? t('settings.hideDetails')
                                  : t('settings.showDetails')}
                                <DropdownArrowSvg
                                  isOpen={isExpanded}
                                  className="text-white"
                                />
                              </button>
                            )}
                            {isExpanded && hasSponsorDetails && (
                              <div className="mt-2 space-y-2 rounded-md bg-alpha-whiteAlpha100 p-3">
                                {renderCopyableValue({
                                  displayValue: candidate.sponsor?.signer
                                    ? ellipsis(candidate.sponsor.signer, 8, 6)
                                    : undefined,
                                  label: sponsorSignerLabel,
                                  value: candidate.sponsor?.signer,
                                })}
                                {renderCopyableValue({
                                  label: sponsorUrlLabel,
                                  value: candidate.sponsor?.url,
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          <div className="w-full px-4 absolute bottom-12 md:static space-y-3">
            {candidates.length > 0 && (
              <p className="text-center text-xs text-brand-graylight">
                {t('settings.passkeyRecoverySelectedCount', {
                  count: selectedCount,
                })}
              </p>
            )}
            <NeutralButton
              type="button"
              disabled={candidates.length > 0 ? isImportDisabled : loading}
              loading={loading}
              onClick={
                candidates.length > 0
                  ? importSelectedPasskeyAccounts
                  : discoverPasskeyAccounts
              }
              fullWidth
            >
              {candidates.length > 0
                ? t('settings.importSelectedPasskeyAccounts')
                : t('settings.findPasskeyAccounts')}
            </NeutralButton>
          </div>
        </>
      )}
    </>
  );
};

export default RecoverPasskeyAccounts;
