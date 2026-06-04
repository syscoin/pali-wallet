import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { Card, NeutralButton } from 'components/index';
import { CreatedAccountSuccessfully } from 'components/Modal/WarningBaseModal';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { formatFullPrecisionBalance, ellipsis } from 'utils/index';
import { navigateBack } from 'utils/navigationState';
import { bytesToHex, getDiscoverablePasskeyAssertion } from 'utils/passkey';

const scrollAreaClassName =
  'remove-scrollbar flex w-full max-w-[352px] max-h-[calc(100vh-260px)] flex-col gap-4 overflow-y-auto pb-36 text-left';

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
};

const RecoverPasskeyAccounts = () => {
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const navigate = useNavigate();
  const location = useLocation();

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
  const loading = discovering || importing;
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
      const assertion = await getDiscoverablePasskeyAssertion(
        bytesToHex(challenge)
      );
      const credentialParams = {
        backupStatus: assertion.backupStatus,
        credentialId: assertion.credentialId,
        credentialIdHash: assertion.credentialIdHash,
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

  const getPolicyLabel = (candidate: RecoveryCandidate) => {
    const mode = candidate.sponsor?.mode || 'disabled';
    return t(`settings.passkeyPolicy.${mode}.title`, {
      defaultValue: t('settings.passkeyPolicy.disabled.title'),
    });
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
                            <button
                              type="button"
                              className="block max-w-full truncate text-left font-medium text-white"
                              disabled={loading}
                              onClick={() => toggleCandidate(candidate)}
                            >
                              {ellipsis(candidate.address, 8, 6)}
                            </button>
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
                                  policy: getPolicyLabel(candidate),
                                })}
                              </span>
                            </div>
                            {hasSponsorDetails && (
                              <button
                                type="button"
                                className="mt-2 text-brand-blue500 font-medium disabled:opacity-60"
                                disabled={loading}
                                onClick={() => toggleDetails(candidate)}
                              >
                                {isExpanded
                                  ? t('settings.hideDetails')
                                  : t('settings.showDetails')}
                              </button>
                            )}
                            {isExpanded && hasSponsorDetails && (
                              <div className="mt-2 rounded-md bg-alpha-whiteAlpha100 p-2 break-all">
                                {candidate.sponsor?.signer && (
                                  <p>
                                    {t(
                                      'settings.passkeyRecoverySponsorSigner',
                                      {
                                        signer: ellipsis(
                                          candidate.sponsor.signer,
                                          8,
                                          6
                                        ),
                                      }
                                    )}
                                  </p>
                                )}
                                {candidate.sponsor?.url && (
                                  <p className="mt-1">
                                    {t('settings.passkeyRecoverySponsorUrl', {
                                      url: candidate.sponsor.url,
                                    })}
                                  </p>
                                )}
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
