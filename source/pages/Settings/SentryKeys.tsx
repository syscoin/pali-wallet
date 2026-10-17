import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button, Icon, PageActionFooter } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import type { SentryCollateralReservation } from 'utils/sentry/collateral';
import { getSentryNetwork } from 'utils/sentry/network';
import type { SentrySettings } from 'utils/sentry/types';

import type {
  SentryAuthorityRole,
  SentryAuthorityScheme,
} from '@sidhujag/sysweb3-sentry';

const fieldClass =
  'mt-2 w-full min-w-0 min-h-11 rounded-xl border border-fields-input-border bg-bkg-1 p-3 text-sm text-white focus:border-fields-input-borderfocus';

/** Keys never enter Redux, navigation state, the dapp or analytics. */
const SentryKeys = () => {
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const scope = useSelector((state: RootState) =>
    JSON.stringify({
      account: state.vault.activeAccount,
      wallet: state.vault.accounts?.HDAccount?.[0]?.xpub,
      network: state.vault.activeNetwork,
      slip44: state.vaultGlobal.activeSlip44,
    })
  );
  const network = useSelector((state: RootState) => state.vault.activeNetwork);
  const [settings, setSettings] = useState<SentrySettings>();
  const [mode, setMode] = useState<
    'list' | 'import' | 'service' | 'remove' | 'release'
  >('list');
  const [role, setRole] = useState<SentryAuthorityRole>('operator');
  const [scheme, setScheme] = useState<SentryAuthorityScheme>('bls-basic');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [password, setPassword] = useState('');
  const [backup, setBackup] = useState(false);
  const [serviceUrl, setServiceUrl] = useState('');
  const [feeLimit, setFeeLimit] = useState('100000');
  const [removeId, setRemoveId] = useState('');
  const [release, setRelease] = useState<SentryCollateralReservation>();
  const [releaseAcknowledged, setReleaseAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedRemovalKey = settings?.keys.find((key) => key.id === removeId);
  const owner = useRef(scope);
  const active = useRef(true);
  const inFlight = useRef<symbol | null>(null);
  owner.current = scope;

  let supported = true;
  try {
    getSentryNetwork(network);
  } catch {
    supported = false;
  }

  useEffect(() => {
    let cancelled = false;
    active.current = true;
    inFlight.current = null;
    setBusy(false);
    setSettings(undefined);
    setMode('list');
    setSecret('');
    setPassword('');
    setBackup(false);
    setRemoveId('');
    setError('');
    setNotice('');
    if (supported)
      void controllerEmitter(['wallet', 'getSentrySettings'])
        .then((value: SentrySettings) => {
          if (cancelled || owner.current !== scope) return;
          setSettings(value);
          setServiceUrl(value.serviceUrl);
          setFeeLimit(value.maxFeeSatoshis);
        })
        .catch((reason) => {
          if (!cancelled && owner.current === scope)
            setError(reason.message || t('sentry.unableToLoadSentrySettings'));
        });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [controllerEmitter, scope, supported]);

  const back = () => {
    setMode('list');
    setSecret('');
    setPassword('');
    setBackup(false);
    setRemoveId('');
    setError('');
    setNotice('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !password) return;
    const current = scope;
    const job = Symbol('sentry-settings-job');
    inFlight.current = job;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'import') {
        if (!backup)
          throw new Error(t('sentry.confirmThatYouHaveBackedUpThisOperator'));
        await controllerEmitter(
          ['wallet', 'importSentryKey'],
          [{ role, scheme, label, secretKey: secret, password }],
          180000,
          false
        );
      } else if (mode === 'service') {
        await controllerEmitter(
          ['wallet', 'saveSentrySettings'],
          [{ serviceUrl, maxFeeSatoshis: feeLimit, password }],
          30000,
          false
        );
      } else if (mode === 'remove') {
        if (!selectedRemovalKey)
          throw new Error(t('sentry.unableToLoadSentrySettings'));
        await controllerEmitter(
          ['wallet', 'removeSentryKey'],
          [{ id: removeId, password }],
          30000,
          false
        );
      } else if (mode === 'release' && release) {
        await controllerEmitter(
          ['wallet', 'releaseSentryCollateral'],
          [
            {
              reservation: release,
              password,
              acknowledgeNodeStops: releaseAcknowledged,
            },
          ],
          30000,
          false
        );
      }
      if (
        !active.current ||
        owner.current !== current ||
        inFlight.current !== job
      )
        return;
      if (mode === 'import') setBackup(false);
      const value = (await controllerEmitter([
        'wallet',
        'getSentrySettings',
      ])) as SentrySettings;
      if (
        !active.current ||
        owner.current !== current ||
        inFlight.current !== job
      )
        return;
      setSettings(value);
      setMode('list');
      setNotice(
        mode === 'import'
          ? t('sentry.operatorKeyImportedSecurely')
          : mode === 'remove'
          ? t(
              'sentry.localOperatorKeyRemovedRegisteredCollateralRemainsProtected'
            )
          : mode === 'release'
          ? t('sentry.collateralProtectionRemovedSpendingThisOutputWillStop')
          : t('sentry.trustedServiceSettingsSaved')
      );
    } catch (reason: any) {
      if (
        active.current &&
        owner.current === current &&
        inFlight.current === job
      )
        setError(
          reason?.message || t('sentry.unableToCompleteSentryOperation')
        );
    } finally {
      if (inFlight.current === job) {
        inFlight.current = null;
        if (active.current && owner.current === current) {
          setBusy(false);
          setPassword('');
          setSecret('');
        }
      }
    }
  };

  if (!supported)
    return (
      <p role="status" className="p-4 text-sm">
        {t('sentry.switchToSyscoinMainnetOrSyscoinTestnetUTXO')}
      </p>
    );
  if (!settings && !error)
    return (
      <p role="status" className="p-4 text-sm">
        {t('sentry.loadingSentrySettings')}
      </p>
    );

  return (
    <form
      onSubmit={submit}
      autoComplete="off"
      className="flex min-w-0 w-full flex-col gap-5 text-left text-white"
    >
      <section className="rounded-xl border border-brand-blue600 bg-bkg-2 p-4">
        <div className="flex items-start gap-3">
          <Icon name="Key" isSvg className="shrink-0" />
          <div className="min-w-0">
            <h2 className="font-medium">{t('sentry.sentryAuthorityKeys')}</h2>
            <p className="mt-2 text-sm text-brand-gray200">
              {t('sentry.ownerOperatorVotingAndCollateralKeysStaySeparate')}
            </p>
          </div>
        </div>
        <p className="mt-3 break-words text-xs text-brand-gray200">
          {network.label} · {settings?.keys.length || 0}{' '}
          {t('sentry.importedKeys')}
        </p>
      </section>
      {notice && (
        <p role="status" className="rounded-lg bg-bkg-2 p-3 text-sm">
          {notice}
        </p>
      )}
      {mode === 'list' && (
        <>
          <p className="text-sm text-brand-gray200">
            {t('sentry.manageYourNodesInSysnodeThisWalletAuthorizes')}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => {
                setMode('import');
                setBackup(false);
                setLabel('');
                setSecret('');
                setPassword('');
                setError('');
                setNotice('');
              }}
            >
              {t('sentry.importSentryKey')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMode('service');
                setError('');
              }}
            >
              {t('sentry.trustedDataService')}
            </Button>
          </div>
          {!settings?.keys.length && (
            <p className="rounded-lg border border-brand-blue600 p-4 text-sm">
              {t('sentry.noSentryKeysImportedOnThisNetwork')}
            </p>
          )}
          {settings?.keys.map((key) => (
            <section
              key={key.id}
              className="min-w-0 rounded-xl border border-brand-blue600 p-4"
            >
              <h3 className="break-words font-medium">{key.label}</h3>
              <p className="mt-1 text-xs text-brand-gray200">
                {key.scheme === 'bls-basic'
                  ? t('sentry.legacyBLS')
                  : key.scheme === 'secp256k1'
                  ? t('sentry.secp256k1')
                  : t('sentry.sLHDSASHAKE128s')}{' '}
                · {t(`sentry.roles.${key.role}`)}
              </p>
              <p className="mt-3 break-all font-mono text-xs">
                {key.publicKey}
              </p>
              <button
                type="button"
                aria-label={t('sentry.copyPublicKeyFor', { label: key.label })}
                className="mt-2 min-h-11 rounded-lg px-3 text-sm hover:bg-bkg-2 focus-visible:outline focus-visible:outline-2"
                onClick={() => {
                  void navigator.clipboard.writeText(key.publicKey).then(
                    () => setNotice(t('sentry.publicKeyCopied')),
                    () =>
                      setError(t('sentry.unableToCopyPublicKeyYouCanSelect'))
                  );
                }}
              >
                {t('sentry.copyPublicKey')}
              </button>
              <button
                type="button"
                className="mt-3 min-h-11 rounded-lg px-3 text-sm text-warning-error hover:bg-bkg-2 focus-visible:outline focus-visible:outline-2"
                onClick={() => {
                  setRemoveId(key.id);
                  setMode('remove');
                  setError('');
                }}
              >
                {t('sentry.removeLocalKey')}
              </button>
            </section>
          ))}
          <section className="rounded-xl border border-brand-blue600 p-4">
            <h3 className="font-medium">{t('sentry.protectedCollateral')}</h3>
            <p className="mt-2 text-xs text-brand-gray200">
              {t('sentry.onlyLinkedVerifiedCollateralOutputsAreProtectedOther')}
            </p>
            {!settings?.collateral?.length && (
              <p className="mt-3 text-sm">
                {t('sentry.noLinkedCollateralInThisWallet')}
              </p>
            )}
            {settings?.collateral?.map((entry) => (
              <div
                key={`${entry.txid}:${entry.vout}`}
                className="mt-4 min-w-0 border-t border-brand-blue600 pt-4"
              >
                <p className="text-xs text-brand-gray200">{t('sentry.node')}</p>
                <p className="mt-1 break-all font-mono text-xs">
                  {entry.proTxHash || t('sentry.pendingRegistration')}
                </p>
                <p className="mt-3 text-xs text-brand-gray200">
                  {t('sentry.protectedOutpoint')}
                </p>
                <p className="mt-1 break-all font-mono text-xs">
                  {entry.txid}:{entry.vout}
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-lg px-3 text-sm text-warning-error hover:bg-bkg-2 focus-visible:outline focus-visible:outline-2"
                  onClick={() => {
                    setRelease(entry);
                    setReleaseAcknowledged(false);
                    setMode('release');
                    setError('');
                  }}
                >
                  {t('sentry.unlockCollateral')}
                </button>
              </div>
            ))}
          </section>
        </>
      )}
      {mode === 'import' && (
        <>
          <label className="text-sm">
            {t('sentry.keyRole')}
            <select
              aria-label={t('sentry.keyRole')}
              className={fieldClass}
              value={role}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as SentryAuthorityRole;
                setRole(next);
                setScheme(next === 'operator' ? 'bls-basic' : 'secp256k1');
                setSecret('');
                setBackup(false);
              }}
            >
              <option value="operator">{t('sentry.operator')}</option>
              <option value="owner">{t('sentry.owner')}</option>
              <option value="voting">{t('sentry.voting')}</option>
              <option value="collateral">{t('sentry.collateral')}</option>
            </select>
          </label>
          <label className="text-sm">
            {t('sentry.keyType')}
            <select
              aria-label={t('sentry.keyType')}
              className={fieldClass}
              value={scheme}
              disabled={busy}
              onChange={(e) => {
                setScheme(e.target.value as SentryAuthorityScheme);
                setSecret('');
                setBackup(false);
              }}
            >
              {role === 'operator' ? (
                <option value="bls-basic">{t('sentry.legacyBLSBasic')}</option>
              ) : (
                <option value="secp256k1">{t('sentry.legacySecp256k1')}</option>
              )}
              {role !== 'collateral' && (
                <option value="slh-dsa-shake-128s">
                  {t('sentry.sLHDSASHAKE128sSentryPQ')}
                </option>
              )}
            </select>
          </label>
          <label className="text-sm">
            {t('sentry.keyLabel')}
            <input
              className={fieldClass}
              value={label}
              maxLength={80}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t(
              scheme === 'secp256k1'
                ? 'sentry.sentryPrivateKeyHexOrWif'
                : 'sentry.sentryPrivateKeyHex'
            )}
            <input
              className={fieldClass}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={secret}
              maxLength={130}
              disabled={busy}
              onChange={(e) => {
                setSecret(e.target.value);
                setBackup(false);
              }}
            />
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 min-h-5 min-w-5"
              checked={backup}
              disabled={busy}
              onChange={(e) => setBackup(e.target.checked)}
            />
            <span>{t('sentry.iHaveASeparateBackupImportedSentryKeys')}</span>
          </label>
        </>
      )}
      {mode === 'service' && (
        <>
          <p className="text-sm text-brand-gray200">
            {t('sentry.thisServiceReportsRegisteredNodeStateAndActivation')}
          </p>
          <label className="text-sm">
            {t('sentry.trustedHTTPSServiceOrigin')}
            <input
              className={fieldClass}
              type="url"
              value={serviceUrl}
              disabled={busy}
              placeholder="https://sysnode.info"
              onChange={(e) => setServiceUrl(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t('sentry.maximumTransactionFeeSatoshis')}
            <input
              className={fieldClass}
              inputMode="numeric"
              value={feeLimit}
              disabled={busy}
              onChange={(e) => setFeeLimit(e.target.value)}
            />
          </label>
          <p className="text-xs text-brand-gray200">
            {t('sentry.onlyFixedReadonlySentryEndpointsAreUsedA')}
          </p>
        </>
      )}
      {mode === 'remove' && (
        <>
          <p className="text-sm">
            {t('sentry.removeThisKeyFromTheLocalWalletThis')}
          </p>
          {selectedRemovalKey && (
            <section className="min-w-0 rounded-xl border border-warning-error p-4">
              <h3 className="break-words font-medium">
                {selectedRemovalKey.label}
              </h3>
              <p className="mt-1 text-xs text-brand-gray200">
                {selectedRemovalKey.scheme === 'bls-basic'
                  ? t('sentry.legacyBLS')
                  : selectedRemovalKey.scheme === 'secp256k1'
                  ? t('sentry.secp256k1')
                  : t('sentry.sLHDSASHAKE128s')}{' '}
                · {t(`sentry.roles.${selectedRemovalKey.role}`)}
              </p>
              <p className="mt-3 break-all font-mono text-xs">
                {selectedRemovalKey.publicKey}
              </p>
            </section>
          )}
        </>
      )}
      {mode === 'release' && release && (
        <section className="rounded-xl border border-warning-error p-4">
          <h3 className="font-medium">{t('sentry.unlockThisCollateral')}</h3>
          <p className="mt-2 text-sm">
            {t('sentry.spendingThisOutputStopsTheSentryNodeAnd')}
          </p>
          <p className="mt-3 break-all font-mono text-xs">
            {release.txid}:{release.vout}
          </p>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 min-h-5 min-w-5"
              checked={releaseAcknowledged}
              disabled={busy}
              onChange={(e) => setReleaseAcknowledged(e.target.checked)}
            />
            <span>{t('sentry.iIntendToStopThisNodeAndAllow')}</span>
          </label>
        </section>
      )}
      {mode !== 'list' && (
        <label className="text-sm">
          {t('sentry.walletPassword')}
          <input
            className={fieldClass}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}
      <PageActionFooter error={error || undefined}>
        {mode !== 'list' && (
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={back}
              disabled={busy}
              className="flex-1"
            >
              {t('buttons.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !password ||
                (mode === 'remove' && !selectedRemovalKey) ||
                (mode === 'release' && !releaseAcknowledged) ||
                (mode === 'import' && (!secret || !label.trim() || !backup))
              }
              loading={busy}
              className="flex-1"
            >
              {mode === 'import'
                ? t('buttons.import')
                : mode === 'remove'
                ? t('buttons.remove')
                : mode === 'release'
                ? t('sentry.unlockCollateral')
                : t('buttons.save')}
            </Button>
          </div>
        )}
      </PageActionFooter>
    </form>
  );
};

export default SentryKeys;
