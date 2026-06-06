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
  const [guardianAddress, setGuardianAddress] = useState<string>('');
  const [guardianLoading, setGuardianLoading] = useState<boolean>(false);
  const [guardianStep, setGuardianStep] = useState<string>('');
  const [guardianReplacementCredential, setGuardianReplacementCredential] =
    useState<GuardianReplacementCredential | null>(null);
  const loading = discovering || importing || guardianLoading;
  const selectedCount = selectedAddresses.size;
  const allSelected =
    candidates.length > 0 && selectedAddresses.size === candidates.length;
  const isImportDisabled = loading || selectedCount === 0;

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
    const account = recoveryAccountAddress.trim();
    const guardian = guardianAddress.trim();
    if (!account) {
      alert.error(t('settings.passkeyGuardianRecoveryAccountRequired'));
      return;
    }
    if (!guardian) {
      alert.error(t('settings.passkeyGuardianRequired'));
      return;
    }

    setGuardianLoading(true);
    try {
      setGuardianStep(t('settings.passkeyGuardianRecoveryStepPasskey'));
      await controllerEmitter(['wallet', 'assertPasskeySmartAccountSupported']);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const newCredential = await createPasskeyCredential({
        accountName: t('settings.passkeyRecoveryReplacementName'),
        challengeHex: bytesToHex(challenge),
        userDisplayName: t('settings.passkeyRecoveryReplacementName'),
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

      alert.success(t('settings.passkeyGuardianRecoveryStarted'));
    } catch (error: any) {
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        alert.error(
          error?.message || t('settings.passkeyGuardianRecoveryStartFailed')
        );
      }
    } finally {
      setGuardianLoading(false);
      setGuardianStep('');
    }
  };

  const importGuardianRecoveredAccount = async (account: string) => {
    setGuardianStep(t('settings.passkeyGuardianRecoveryStepImport'));
    const storedReplacement =
      guardianReplacementCredential ||
      (() => {
        const stored = localStorage.getItem(
          guardianReplacementCredentialKey(account)
        );
        if (!stored) return null;
        try {
          return JSON.parse(stored) as GuardianReplacementCredential;
        } catch {
          return null;
        }
      })();
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
    const account = recoveryAccountAddress.trim();
    if (!account) {
      alert.error(t('settings.passkeyGuardianRecoveryAccountRequired'));
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
          await importGuardianRecoveredAccount(account);
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
                {t('settings.passkeyGuardianRecoveryTitle')}
              </p>
              <p className="mt-2 leading-5">
                {t('settings.passkeyGuardianRecoveryLostDescription')}
              </p>
              <input
                type="text"
                className="custom-input-normal passkey-input relative mt-3 w-full"
                disabled={loading}
                placeholder={t(
                  'settings.passkeyGuardianRecoveryAccountAddress'
                )}
                value={recoveryAccountAddress}
                onChange={(event) =>
                  setRecoveryAccountAddress(event.target.value)
                }
              />
              <input
                type="text"
                className="custom-input-normal passkey-input relative mt-3 w-full"
                disabled={loading}
                placeholder={t('settings.passkeyGuardianAddress')}
                value={guardianAddress}
                onChange={(event) => setGuardianAddress(event.target.value)}
              />
              {guardianStep && (
                <p className="mt-3 text-brand-yellowInfo">{guardianStep}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="rounded-full border border-brand-blue500 bg-brand-blue500 bg-opacity-20 px-3 py-2 text-xs font-medium text-brand-blue100 transition-all duration-200 hover:border-brand-blue100 hover:bg-brand-blue500 hover:bg-opacity-40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
                  onClick={startGuardianRecovery}
                >
                  {t('settings.passkeyGuardianRecoveryStart')}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100 px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading}
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
                : t('settings.recoverPasskeyAccounts')}
            </NeutralButton>
          </div>
        </>
      )}
    </>
  );
};

export default RecoverPasskeyAccounts;
