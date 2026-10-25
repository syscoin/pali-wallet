import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallowEqual, useSelector } from 'react-redux';

import { Button } from 'components/Button';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import type { IPrivateNoteView } from 'utils/privacy/privateVaultTypes';
import { PRIVACY_POOLS } from 'utils/privacy/registry';
import type {
  IPrivacyRelayerChoice,
  IPrivacyWithdrawalReview,
  IPrivacyWithdrawalSubmission,
} from 'utils/privacy/withdrawTypes';

interface IPrivateWithdrawalProps {
  note: IPrivateNoteView;
  onBack: () => void;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const uint = (value: unknown) => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new Error('Invalid withdrawal review');
  return BigInt(value);
};
const eth = (value: string) => {
  const digits = uint(value).toString().padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return digits.slice(0, -18) + (fraction ? `.${fraction}` : '');
};
function readReview(
  raw: unknown,
  note: IPrivateNoteView,
  mode: 'direct' | 'relayed',
  recipient: string,
  relayerId: string
): IPrivacyWithdrawalReview {
  const value = raw as IPrivacyWithdrawalReview;
  const pool = PRIVACY_POOLS.find(({ id }) => id === note.poolId)!;
  if (
    !value ||
    !UUID.test(value.intentId) ||
    value.noteId !== note.id ||
    value.poolId !== pool.id ||
    value.amount !== pool.amount ||
    value.poolAddress !== pool.address ||
    value.mode !== mode ||
    value.chainId !== 1 ||
    !ADDRESS.test(value.recipient) ||
    value.recipient.toLowerCase() !== recipient.toLowerCase() ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < 0 ||
    value.gasLimit !== '650000' ||
    !value.account ||
    !Number.isSafeInteger(value.account.id) ||
    value.account.id < 0 ||
    !['HDAccount', 'Imported'].includes(value.account.type) ||
    !ADDRESS.test(value.account.address)
  )
    throw new Error('Invalid withdrawal review');
  const fee = uint(value.feeWei),
    network = uint(value.maxNetworkFeeWei),
    service = uint(value.serviceFeeWei),
    receive = uint(value.receiveWei);
  if (
    eth(String(receive + fee)) !== pool.amount ||
    (mode === 'direct'
      ? fee !== BigInt(0) || service !== BigInt(0) || network === BigInt(0)
      : fee !== network + service ||
        value.relayerId !== relayerId ||
        !HASH.test(value.relayerId) ||
        typeof value.relayerName !== 'string' ||
        value.relayerName.length > 255 ||
        typeof value.relayerEndpoint !== 'string' ||
        value.relayerEndpoint.length > 2048)
  )
    throw new Error('Invalid withdrawal review');
  if (mode === 'relayed') {
    const endpoint = new URL(value.relayerEndpoint!);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      throw new Error('Invalid withdrawal review');
  }
  return {
    intentId: value.intentId,
    noteId: note.id,
    poolId: pool.id,
    amount: pool.amount,
    poolAddress: pool.address,
    chainId: 1,
    mode,
    account: {
      id: value.account.id,
      type: value.account.type,
      address: value.account.address,
    },
    recipient: value.recipient,
    expiresAt: value.expiresAt,
    gasLimit: value.gasLimit,
    feeWei: value.feeWei,
    maxNetworkFeeWei: value.maxNetworkFeeWei,
    serviceFeeWei: value.serviceFeeWei,
    receiveWei: value.receiveWei,
    ...(mode === 'relayed'
      ? {
          relayerId: value.relayerId,
          relayerName: value.relayerName,
          relayerEndpoint: value.relayerEndpoint,
        }
      : {}),
  };
}
function WithdrawalFlow({
  note,
  onBack,
  emitter,
}: IPrivateWithdrawalProps & { emitter: (...args: any[]) => Promise<any> }) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState('');
  const [mode, setMode] = useState<'direct' | 'relayed'>('direct');
  const [relayers, setRelayers] = useState<IPrivacyRelayerChoice[]>([]);
  const [relayerId, setRelayerId] = useState('');
  const [busy, setBusy] = useState<'directory' | 'prepare' | 'submit' | null>(
    null
  );
  const [error, setError] = useState('');
  const [review, setReview] = useState<IPrivacyWithdrawalReview>();
  const [result, setResult] = useState<IPrivacyWithdrawalSubmission>();
  const [consumed, setConsumed] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const owner = useRef({
    active: true,
    revision: 0,
    busy: false,
    preparing: false,
    intent: undefined as string | undefined,
  });
  const current = (revision: number) =>
    owner.current.active &&
    owner.current.revision === revision &&
    document.visibilityState !== 'hidden';
  const call = (method: string, args: unknown[] = [], timeout = 10000) =>
    emitter(['privacyWithdrawals', method], args, timeout, false);
  const discard = (id?: string) => {
    if (id) void call('discardWithdrawal', [id]).catch(() => undefined);
  };
  const cancel = () => {
    if (owner.current.preparing)
      void call('cancelPreparation').catch(() => undefined);
    owner.current.preparing = false;
  };
  useEffect(() => {
    owner.current.active = true;
    return () => {
      owner.current.active = false;
      owner.current.revision++;
      cancel();
      discard(owner.current.intent);
    };
  }, []);
  useEffect(() => {
    if (!review || result || busy === 'submit') return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review, result, busy]);
  const loadRelayers = async () => {
    const revision = ++owner.current.revision;
    setBusy('directory');
    setError('');
    setRelayerId('');
    try {
      const raw = await call('getRelayers', [], 20000);
      if (!current(revision)) return;
      if (!Array.isArray(raw) || raw.length > 1000) throw new Error();
      const choices: IPrivacyRelayerChoice[] = raw.map(
        (value: IPrivacyRelayerChoice) => {
          if (
            !value ||
            !HASH.test(value.id) ||
            typeof value.name !== 'string' ||
            !value.name ||
            value.name.length > 255 ||
            !['unavailable', 'reported-healthy', 'reported-unhealthy'].includes(
              value.health
            ) ||
            !Array.isArray(value.supportedPools) ||
            value.supportedPools.some(
              (id) => !PRIVACY_POOLS.some((pool) => pool.id === id)
            ) ||
            (value.feePercent !== undefined &&
              (typeof value.feePercent !== 'string' ||
                !/^(?:0|[1-9][0-9]?|100)(?:\.[0-9]{1,18})?$/.test(
                  value.feePercent
                )))
          )
            throw new Error();
          return {
            id: value.id,
            name: value.name,
            health: value.health,
            feePercent: value.feePercent,
            supportedPools: [...value.supportedPools],
          };
        }
      );
      if (new Set(choices.map(({ id }) => id)).size !== choices.length)
        throw new Error();
      setRelayers(
        choices.filter(({ supportedPools }) =>
          supportedPools.includes(note.poolId)
        )
      );
    } catch {
      if (current(revision)) {
        setRelayers([]);
        setError('directoryFailed');
      }
    } finally {
      if (current(revision)) setBusy(null);
    }
  };
  const prepare = async () => {
    if (
      owner.current.busy ||
      !ADDRESS.test(recipient.trim()) ||
      (mode === 'relayed' && !relayerId)
    )
      return;
    owner.current.busy = true;
    owner.current.preparing = true;
    const revision = ++owner.current.revision;
    discard(owner.current.intent);
    owner.current.intent = undefined;
    setBusy('prepare');
    setError('');
    try {
      const raw = await call(
        'prepareWithdrawal',
        [
          {
            noteId: note.id,
            recipient: recipient.trim(),
            mode,
            ...(mode === 'relayed' ? { relayerId } : {}),
          },
        ],
        120000
      );
      const next = readReview(raw, note, mode, recipient.trim(), relayerId);
      if (!current(revision)) {
        discard(next.intentId);
        return;
      }
      owner.current.intent = next.intentId;
      setReview(next);
      setConsumed(false);
      setClock(Date.now());
    } catch {
      if (current(revision)) {
        cancel();
        setError('prepareFailed');
      }
    } finally {
      if (current(revision)) {
        owner.current.busy = false;
        owner.current.preparing = false;
        setBusy(null);
      }
    }
  };
  const submit = async () => {
    if (
      !review ||
      consumed ||
      owner.current.busy ||
      Date.now() >= review.expiresAt
    )
      return;
    owner.current.busy = true;
    owner.current.intent = undefined;
    const revision = ++owner.current.revision;
    setBusy('submit');
    setConsumed(true);
    setError('');
    try {
      const raw = (await call(
        'submitWithdrawal',
        [review.intentId],
        120000
      )) as IPrivacyWithdrawalSubmission;
      if (!current(revision)) return;
      if (
        !raw ||
        raw.intentId !== review.intentId ||
        raw.noteId !== note.id ||
        !['submitted', 'unknown'].includes(raw.phase) ||
        (raw.transactionHash !== undefined &&
          !HASH.test(raw.transactionHash)) ||
        (raw.jobId !== undefined &&
          (mode !== 'relayed' ||
            typeof raw.jobId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(raw.jobId))) ||
        (raw.phase === 'submitted' && !raw.transactionHash && !raw.jobId)
      )
        throw new Error();
      setResult({
        intentId: raw.intentId,
        noteId: raw.noteId,
        phase: raw.phase,
        ...(raw.transactionHash
          ? { transactionHash: raw.transactionHash }
          : {}),
        ...(raw.jobId ? { jobId: raw.jobId } : {}),
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
          noteId: note.id,
          phase: 'unknown',
        });
    } finally {
      if (current(revision)) {
        owner.current.busy = false;
        setBusy(null);
      }
    }
  };
  const expired = Boolean(review && clock >= review.expiresAt);
  const actionClass =
    'rounded p-1 text-xs text-brand-royalbluemedium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
  const heading = result
    ? result.phase === 'unknown'
      ? 'unknown'
      : result.jobId && !result.transactionHash
      ? 'accepted'
      : 'submitted'
    : review
    ? 'review'
    : 'title';
  return (
    <section
      className="mx-auto w-full max-w-md px-4 py-6 text-white space-y-4"
      aria-labelledby="privacy-withdrawal-title"
    >
      <h1 id="privacy-withdrawal-title" className="text-lg font-medium">
        {t(`privacy.withdrawal.${heading}`)}
      </h1>
      {!review && (
        <div className="space-y-3 text-sm">
          <p>{note.amount} ETH</p>
          <label htmlFor="privacy-withdrawal-recipient" className="block">
            {t('privacy.withdrawal.recipient')}
          </label>
          <input
            id="privacy-withdrawal-recipient"
            value={recipient}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={42}
            disabled={busy === 'prepare'}
            onChange={(event) => {
              setRecipient(event.target.value);
              setError('');
            }}
            className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-xs"
          />
          <fieldset disabled={Boolean(busy)} className="space-y-2">
            <legend>{t('privacy.withdrawal.method')}</legend>
            {(['direct', 'relayed'] as const).map((value) => (
              <label key={value} className="flex gap-2">
                <input
                  type="radio"
                  name="privacy-withdrawal-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    setError('');
                    if (value === 'relayed') void loadRelayers();
                    else owner.current.revision++;
                  }}
                />
                {t(`privacy.withdrawal.${value}`)}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-brand-gray200">
            {t(
              `privacy.withdrawal.${
                mode === 'direct' ? 'directWarning' : 'relayedWarning'
              }`
            )}
          </p>
          {mode === 'relayed' && (
            <div className="space-y-2">
              {busy === 'directory' ? (
                <p role="status">{t('privacy.withdrawal.loadingRelayers')}</p>
              ) : (
                <>
                  <label htmlFor="privacy-withdrawal-relayer" className="block">
                    {t('privacy.withdrawal.relayer')}
                  </label>
                  <select
                    id="privacy-withdrawal-relayer"
                    value={relayerId}
                    disabled={Boolean(busy)}
                    onChange={(event) => setRelayerId(event.target.value)}
                    className="w-full rounded-lg border border-alpha-whiteAlpha300 bg-bkg-4 p-3 text-xs"
                  >
                    <option value="">
                      {t('privacy.withdrawal.chooseRelayer')}
                    </option>
                    {relayers.map((relayer) => (
                      <option
                        key={relayer.id}
                        value={relayer.id}
                        disabled={relayer.health !== 'reported-healthy'}
                      >
                        {relayer.name}
                        {relayer.feePercent === undefined
                          ? ''
                          : ` · ${relayer.feePercent}%`}
                        {relayer.health === 'reported-healthy'
                          ? ''
                          : ` · ${t('privacy.withdrawal.unavailableRelayer')}`}
                      </option>
                    ))}
                  </select>
                  {!relayers.length && (
                    <p className="text-xs">
                      {t('privacy.withdrawal.noRelayers')}
                    </p>
                  )}
                  <button
                    type="button"
                    className={actionClass}
                    disabled={Boolean(busy)}
                    onClick={() => void loadRelayers()}
                  >
                    {t('privacy.refresh')}
                  </button>
                </>
              )}
            </div>
          )}
          {busy === 'prepare' && (
            <p role="status" className="text-xs">
              {t('privacy.withdrawal.proving')}
            </p>
          )}
          <Button
            type="button"
            fullWidth
            variant="primary"
            disabled={
              Boolean(busy) ||
              !ADDRESS.test(recipient.trim()) ||
              (mode === 'relayed' && !relayerId)
            }
            loading={busy === 'prepare'}
            onClick={() => void prepare()}
          >
            {t('privacy.withdrawal.continue')}
          </Button>
        </div>
      )}
      {review && !result && (
        <>
          <dl className="rounded-xl border border-alpha-whiteAlpha300 p-3 text-xs space-y-3">
            <div>
              <dt className="text-brand-gray200">
                {t('privacy.withdrawal.recipient')}
              </dt>
              <dd className="break-all">{review.recipient}</dd>
            </div>
            {mode === 'direct' ? (
              <div>
                <dt className="text-brand-gray200">
                  {t('privacy.withdrawal.gasPayer')}
                </dt>
                <dd className="break-all">{review.account.address}</dd>
              </div>
            ) : (
              <div>
                <dt className="text-brand-gray200">
                  {t('privacy.withdrawal.relayer')}
                </dt>
                <dd className="break-all">
                  {review.relayerName}
                  <br />
                  {review.relayerEndpoint}
                </dd>
              </div>
            )}
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
            {mode === 'relayed' && (
              <>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <dt>{t('privacy.withdrawal.serviceFee')}</dt>
                  <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                    {eth(review.serviceFeeWei)} ETH
                  </dd>
                </div>
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <dt>{t('privacy.withdrawal.totalFee')}</dt>
                  <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                    {eth(review.feeWei)} ETH
                  </dd>
                </div>
              </>
            )}
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 font-medium">
              <dt>{t('privacy.withdrawal.receive')}</dt>
              <dd className="ml-auto min-w-0 max-w-full shrink-0 break-words text-right">
                {eth(review.receiveWei)} ETH
              </dd>
            </div>
          </dl>
          <p className="text-xs text-brand-gray200">
            {t(
              `privacy.withdrawal.${
                mode === 'direct' ? 'directWarning' : 'relayedWarning'
              }`
            )}
          </p>
          {!consumed && (
            <p role="status" className="text-xs">
              {t(`privacy.withdrawal.${expired ? 'expired' : 'expires'}`, {
                seconds: Math.max(
                  0,
                  Math.ceil((review.expiresAt - clock) / 1000)
                ),
              })}
            </p>
          )}
          {(expired || consumed) && busy !== 'submit' ? (
            <Button
              type="button"
              fullWidth
              variant="primary"
              disabled={Boolean(busy)}
              loading={busy === 'prepare'}
              onClick={() => void prepare()}
            >
              {t('privacy.deposit.refresh')}
            </Button>
          ) : (
            <Button
              type="button"
              fullWidth
              variant="primary"
              disabled={Boolean(busy)}
              loading={busy === 'submit'}
              onClick={() => void submit()}
            >
              {t(
                `privacy.withdrawal.${
                  busy === 'submit' ? 'submitting' : 'confirm'
                }`
              )}
            </Button>
          )}
        </>
      )}
      {result && (
        <div role="status" className="text-sm space-y-3">
          <p>
            {t(
              `privacy.withdrawal.${
                result.phase === 'unknown'
                  ? 'unknownHelp'
                  : result.jobId && !result.transactionHash
                  ? 'acceptedHelp'
                  : 'submittedHelp'
              }`
            )}
          </p>
          {result.transactionHash && (
            <div className="text-xs">
              <p>{t('privacy.deposit.txHash')}</p>
              <p className="break-all">{result.transactionHash}</p>
            </div>
          )}
          {result.jobId && (
            <div className="text-xs">
              <p>{t('privacy.withdrawal.jobId')}</p>
              <p className="break-all">{result.jobId}</p>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {t(`privacy.withdrawal.${error}`)}
        </p>
      )}
      <button
        type="button"
        className={actionClass}
        disabled={busy === 'submit'}
        onClick={() => {
          owner.current.revision++;
          cancel();
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

export default function PrivateWithdrawal(props: IPrivateWithdrawalProps) {
  const { t } = useTranslation();
  const { controllerEmitter, isUnlocked, isLoading, connectionUnavailable } =
    useController();
  const { scope, eligible } = useSelector((state: RootState) => {
    const { vault, vaultGlobal } = state;
    const ref = vault.activeAccount,
      account = vault.accounts?.[ref.type]?.[ref.id];
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
        !account.isLedgerWallet &&
        !account.isTrezorWallet &&
        !account.isSmartAccount,
    };
  }, shallowEqual);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden'),
      hide = () => setVisible(false);
    document.addEventListener('visibilitychange', change);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', change);
    return () => {
      document.removeEventListener('visibilitychange', change);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', change);
    };
  }, []);
  if (!visible) return null;
  if (
    !eligible ||
    !isUnlocked ||
    isLoading ||
    connectionUnavailable ||
    props.note.phase !== 'verified'
  )
    return (
      <section className="p-4 text-white space-y-3">
        <p role="status">{t('privacy.deposit.unavailable')}</p>
        <button type="button" onClick={props.onBack}>
          {t('buttons.cancel')}
        </button>
      </section>
    );
  return (
    <WithdrawalFlow
      key={`${scope}:${props.note.id}`}
      {...props}
      emitter={controllerEmitter}
    />
  );
}
