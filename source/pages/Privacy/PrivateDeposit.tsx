import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { Button } from 'components/Button';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import type {
  IPrivacyDepositReview,
  IPrivacyDepositSubmission,
} from 'utils/privacy/transactionTypes';
import type { PrivacyPoolId } from 'utils/privacy/types';

interface IPrivateDepositProps {
  onBack: () => void;
  onBackup: (noteId: string) => void | Promise<void>;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const amount = (value: unknown): bigint => {
  if (
    typeof value !== 'string' ||
    value.length > 160 ||
    !/^(?:0|[1-9][0-9]*)$/.test(value)
  )
    throw new Error('Invalid deposit review');
  return BigInt(value);
};
const eth = (value: string) => {
  const digits = amount(value).toString().padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return digits.slice(0, -18) + (fraction ? `.${fraction}` : '');
};
function reviewData(
  raw: unknown,
  poolId: PrivacyPoolId
): IPrivacyDepositReview {
  const value = raw as IPrivacyDepositReview;
  const pool = PRIVACY_POOLS.find((item) => item.id === poolId)!;
  if (
    !value ||
    typeof value.intentId !== 'string' ||
    !UUID.test(value.intentId) ||
    typeof value.noteId !== 'string' ||
    !UUID.test(value.noteId) ||
    value.poolId !== poolId ||
    value.chainId !== 1 ||
    value.amount !== pool.amount ||
    value.poolAddress !== pool.address ||
    !value.account ||
    !Number.isSafeInteger(value.account.id) ||
    value.account.id < 0 ||
    !['HDAccount', 'Imported'].includes(value.account.type) ||
    typeof value.account.address !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.account.address) ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= value.createdAt ||
    value.expiresAt - value.createdAt > 60000 ||
    amount(value.gasLimit) === BigInt(0) ||
    amount(value.nonce) < BigInt(0) ||
    !['legacy', 'eip1559'].includes(value.feeMode) ||
    eth(value.valueWei) !== pool.amount
  )
    throw new Error('Invalid deposit review');
  const rate = amount(
    value.feeMode === 'legacy' ? value.gasPrice : value.maxFeePerGas
  );
  if (
    rate === BigInt(0) ||
    (value.feeMode === 'eip1559' &&
      amount(value.maxPriorityFeePerGas) > rate) ||
    amount(value.maxNetworkFeeWei) !== amount(value.gasLimit) * rate ||
    amount(value.maxTotalWei) !==
      amount(value.valueWei) + amount(value.maxNetworkFeeWei)
  )
    throw new Error('Invalid deposit review');
  return {
    intentId: value.intentId,
    noteId: value.noteId,
    poolId,
    amount: pool.amount,
    poolAddress: pool.address,
    chainId: 1,
    account: {
      id: value.account.id,
      type: value.account.type,
      address: value.account.address,
    },
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    feeMode: value.feeMode,
    gasLimit: value.gasLimit,
    nonce: value.nonce,
    valueWei: value.valueWei,
    maxNetworkFeeWei: value.maxNetworkFeeWei,
    maxTotalWei: value.maxTotalWei,
    ...(value.feeMode === 'legacy'
      ? { gasPrice: value.gasPrice }
      : {
          maxFeePerGas: value.maxFeePerGas,
          maxPriorityFeePerGas: value.maxPriorityFeePerGas,
        }),
  };
}

function DepositFlow({
  onBack,
  onBackup,
  controllerEmitter,
}: IPrivateDepositProps & {
  controllerEmitter: (...args: any[]) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [poolId, setPoolId] = useState<PrivacyPoolId>('eth-0.1');
  const [review, setReview] = useState<IPrivacyDepositReview>();
  const [result, setResult] = useState<IPrivacyDepositSubmission>();
  const [busy, setBusy] = useState<'prepare' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const owner = useRef({
    active: true,
    revision: 0,
    busy: false,
    intent: undefined as string | undefined,
    note: undefined as { id: string; poolId: PrivacyPoolId } | undefined,
  });
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  const discard = (id?: string) => {
    if (id)
      void controllerEmitter(
        ['privacyTransactions', 'discardDeposit'],
        [id],
        10000,
        false
      ).catch(() => undefined);
  };
  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
      discard(owner.current.intent);
    };
  }, []);
  useEffect(() => {
    if (!review || result || busy === 'submit') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review, result, busy]);
  const prepare = async () => {
    if (owner.current.busy) return;
    owner.current.busy = true;
    const revision = ++owner.current.revision;
    discard(owner.current.intent);
    owner.current.intent = undefined;
    setBusy('prepare');
    setError('');
    setAcknowledged(false);
    try {
      const saved = owner.current.note;
      const raw = await controllerEmitter(
        ['privacyTransactions', 'prepareDeposit'],
        [{ poolId, ...(saved?.poolId === poolId ? { noteId: saved.id } : {}) }],
        90000,
        false
      );
      const next = reviewData(raw, poolId);
      if (!current(revision)) {
        discard(next.intentId);
        return;
      }
      owner.current.intent = next.intentId;
      owner.current.note = { id: next.noteId, poolId };
      setReview(next);
      setConsumed(false);
      setClock(Date.now());
    } catch {
      if (current(revision)) setError('prepareFailed');
    } finally {
      if (current(revision)) {
        owner.current.busy = false;
        setBusy(null);
      }
    }
  };
  const submit = async () => {
    if (
      !review ||
      owner.current.busy ||
      consumed ||
      !acknowledged ||
      Date.now() >= review.expiresAt
    )
      return;
    owner.current.busy = true;
    const revision = ++owner.current.revision;
    owner.current.intent = undefined;
    setBusy('submit');
    setConsumed(true);
    setError('');
    try {
      const raw = (await controllerEmitter(
        ['privacyTransactions', 'submitDeposit'],
        [review.intentId],
        120000,
        false
      )) as IPrivacyDepositSubmission;
      if (!current(revision)) return;
      if (
        !raw ||
        raw.intentId !== review.intentId ||
        raw.noteId !== review.noteId ||
        !['submitted', 'unknown'].includes(raw.phase) ||
        (raw.phase === 'submitted' && raw.transactionHash === undefined) ||
        (raw.transactionHash !== undefined &&
          (typeof raw.transactionHash !== 'string' ||
            !/^0x[0-9a-fA-F]{64}$/.test(raw.transactionHash)))
      )
        throw new Error('Invalid submission result');
      setResult({
        intentId: review.intentId,
        noteId: review.noteId,
        phase: raw.phase,
        ...(raw.transactionHash
          ? { transactionHash: raw.transactionHash }
          : {}),
      });
    } catch (failure) {
      if (!current(revision)) return;
      if (
        (failure as { transactionNotBroadcast?: boolean })
          ?.transactionNotBroadcast === true
      )
        setError('notBroadcast');
      else
        setResult({
          intentId: review.intentId,
          noteId: review.noteId,
          phase: 'unknown',
        });
    } finally {
      if (current(revision)) {
        owner.current.busy = false;
        setBusy(null);
      }
    }
  };
  const backup = async () => {
    const noteId = review?.noteId;
    if (!noteId) return;
    const revision = owner.current.revision;
    try {
      await onBackup(noteId);
    } catch {
      if (current(revision)) setError('backupFailed');
    }
  };
  const expired = Boolean(review && clock >= review.expiresAt);
  const linkClass =
    'rounded p-1 text-xs text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
  return (
    <section
      className="mx-auto w-full max-w-md px-4 py-6 text-white space-y-4"
      aria-labelledby="privacy-deposit-title"
    >
      <h1 id="privacy-deposit-title" className="text-lg font-medium">
        {t(
          `privacy.deposit.${
            result ? result.phase : review ? 'review' : 'title'
          }`
        )}
      </h1>
      {!review && (
        <div className="space-y-3">
          <label htmlFor="privacy-deposit-amount" className="block text-sm">
            {t('privacy.deposit.amount')}
          </label>
          <select
            id="privacy-deposit-amount"
            disabled={Boolean(busy)}
            value={poolId}
            onChange={(event) => {
              owner.current.revision++;
              setPoolId(event.target.value as PrivacyPoolId);
              setError('');
            }}
            className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-sm"
          >
            {PRIVACY_POOLS.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.amount} ETH
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="primary"
            fullWidth
            loading={busy === 'prepare'}
            disabled={Boolean(busy)}
            onClick={() => void prepare()}
          >
            {t(`privacy.deposit.${busy ? 'preparing' : 'continue'}`)}
          </Button>
        </div>
      )}
      {review && !result && (
        <>
          <dl className="rounded-xl border border-alpha-whiteAlpha300 p-3 text-xs space-y-3">
            <div>
              <dt className="text-brand-gray200">
                {t('privacy.deposit.account')}
              </dt>
              <dd className="break-all">{review.account.address}</dd>
            </div>
            <div>
              <dt className="text-brand-gray200">
                {t('privacy.deposit.pool')}
              </dt>
              <dd className="break-all">{review.poolAddress}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <dt>{t('privacy.deposit.amount')}</dt>
              <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                {review.amount} ETH
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <dt>{t('privacy.deposit.networkFee')}</dt>
              <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                {eth(review.maxNetworkFeeWei)} ETH
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 font-medium">
              <dt>{t('privacy.deposit.total')}</dt>
              <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                {eth(review.maxTotalWei)} ETH
              </dd>
            </div>
          </dl>
          <div className="rounded-lg border border-alpha-whiteAlpha300 p-3 text-xs space-y-2">
            <p>{t('privacy.deposit.backupWarning')}</p>
            <button
              type="button"
              className={linkClass}
              disabled={Boolean(busy)}
              onClick={() => void backup()}
            >
              {t('privacy.deposit.backup')}
            </button>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={Boolean(busy)}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>{t('privacy.deposit.backupAck')}</span>
            </label>
          </div>
          <p role="status" className="text-xs text-brand-gray200">
            {t(`privacy.deposit.${expired ? 'expired' : 'expires'}`, {
              seconds: Math.max(
                0,
                Math.ceil((review.expiresAt - clock) / 1000)
              ),
            })}
          </p>
          {(expired || consumed) && busy !== 'submit' ? (
            <Button
              type="button"
              variant="primary"
              fullWidth
              disabled={Boolean(busy)}
              loading={busy === 'prepare'}
              onClick={() => void prepare()}
            >
              {t(
                `privacy.deposit.${
                  busy === 'prepare' ? 'preparing' : 'refresh'
                }`
              )}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              fullWidth
              disabled={!acknowledged || Boolean(busy)}
              loading={busy === 'submit'}
              onClick={() => void submit()}
            >
              {t(
                `privacy.deposit.${
                  busy === 'submit' ? 'submitting' : 'confirm'
                }`
              )}
            </Button>
          )}
          <button
            type="button"
            className={linkClass}
            disabled={Boolean(busy)}
            onClick={() => {
              discard(owner.current.intent);
              owner.current.intent = undefined;
              owner.current.revision++;
              setReview(undefined);
              setConsumed(false);
              setError('');
            }}
          >
            {t('privacy.deposit.changeAmount')}
          </button>
        </>
      )}
      {result && (
        <div role="status" className="text-sm space-y-3">
          <p>
            {t(
              `privacy.deposit.${
                result.phase === 'submitted' ? 'submittedHelp' : 'unknownHelp'
              }`
            )}
          </p>
          {result.transactionHash && (
            <div className="text-xs">
              <p className="text-brand-gray200">
                {t('privacy.deposit.txHash')}
              </p>
              <p className="break-all">{result.transactionHash}</p>
            </div>
          )}
          <p className="text-xs text-brand-gray200">
            {t('privacy.deposit.backupWarning')}
          </p>
          <button
            type="button"
            className={linkClass}
            onClick={() => void backup()}
          >
            {t('privacy.deposit.backup')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {t(`privacy.deposit.${error}`)}
        </p>
      )}
      <button
        type="button"
        className={linkClass}
        disabled={Boolean(busy)}
        onClick={() => {
          discard(owner.current.intent);
          owner.current.intent = undefined;
          onBack();
        }}
      >
        {t(result ? 'privacy.deposit.done' : 'buttons.cancel')}
      </button>
    </section>
  );
}

export default function PrivateDeposit(props: IPrivateDepositProps) {
  const { t } = useTranslation();
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const { scope, eligible } = useSelector((state: RootState) => {
    const { vault, vaultGlobal } = state;
    const ref = vault.activeAccount;
    const account = vault.accounts?.[ref.type]?.[ref.id];
    return {
      scope: JSON.stringify([
        ref.type,
        ref.id,
        account?.address,
        account?.xpub,
        vault.activeNetwork.url,
        vault.activeNetwork.chainId,
        vault.isBitcoinBased,
        vaultGlobal.activeSlip44,
        vaultGlobal.lastLogin,
        vault.passkeyCredentialProfile?.credentialIdHash,
      ]),
      eligible:
        !vault.isBitcoinBased &&
        vault.activeNetwork.kind === 'ethereum' &&
        vault.activeNetwork.chainId === 1 &&
        ['HDAccount', 'Imported'].includes(ref.type) &&
        account &&
        (ref.type !== 'Imported' || Boolean(account.xprv)) &&
        !account.isLedgerWallet &&
        !account.isTrezorWallet &&
        !account.isSmartAccount,
    };
  }, shallowEqual);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    const hide = () => setVisible(false);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', update);
    };
  }, []);
  if (!visible) return null;
  if (!eligible || !isUnlocked || isLoading || connectionUnavailable)
    return (
      <section className="p-4 text-white space-y-3">
        <p role="status">{t('privacy.deposit.unavailable')}</p>
        <button type="button" onClick={props.onBack}>
          {t('buttons.cancel')}
        </button>
      </section>
    );
  return (
    <DepositFlow key={scope} {...props} controllerEmitter={controllerEmitter} />
  );
}
