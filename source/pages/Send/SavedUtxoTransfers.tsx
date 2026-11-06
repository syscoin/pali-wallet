import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SYSX_ASSET_GUID } from '../../shared/syscoinAssetIds';
import { useController } from 'hooks/useController';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';

import type { SavedUtxoReviewOutput } from '../../wallet/utxoSavedReview';

type Saved = Readonly<{ accepted: boolean; txid: string }>;
type Review = Readonly<{
  feeSatoshis: string;
  id: string;
  outputs: readonly SavedUtxoReviewOutput[];
}>;

export function SavedUtxoTransfers({ symbol }: { symbol: string }) {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const [saved, setSaved] = useState<readonly Saved[]>([]);
  const [selected, setSelected] = useState<string>();
  const [review, setReview] = useState<Review>();
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(6);
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const heldReview = useRef({ id: undefined as string | undefined });
  useEffect(() => {
    const held = heldReview.current;
    return () => {
      epoch.current++;
      if (held.id)
        void controllerEmitter(
          ['wallet', 'cancelRetainedUtxoRetry'],
          [held.id]
        ).catch(() => undefined);
    };
  }, [controllerEmitter]);
  const cancelReview = () => {
    const id = heldReview.current.id;
    heldReview.current.id = undefined;
    if (id)
      void controllerEmitter(['wallet', 'cancelRetainedUtxoRetry'], [id]).catch(
        () => undefined
      );
    setReview(undefined);
  };
  const run = (work: (owns: () => boolean) => Promise<void>) => {
    const request = ++epoch.current,
      owns = () => request === epoch.current;
    setBusy(true);
    setStatus('');
    void work(owns)
      .catch(() => {
        if (owns()) setStatus(t('transactions.replay.unavailable'));
      })
      .finally(() => {
        if (owns()) setBusy(false);
      });
  };
  const button = 'min-h-9 text-left text-brand-royalblue disabled:opacity-50';
  return (
    <details
      className="mt-3 text-sm"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          epoch.current++;
          cancelReview();
          setSelected(undefined);
          setBusy(false);
          return;
        }
        run(async (owns) => {
          const rows = (await controllerEmitter(
            ['wallet', 'listRetainedUtxoTransfers'],
            []
          )) as readonly Saved[];
          if (owns()) setSaved([...rows].reverse());
        });
      }}
    >
      <summary className="cursor-pointer py-2 text-brand-royalblue">
        {t('send.savedUtxo.title')}
      </summary>
      <div className="flex flex-col gap-1 rounded-lg bg-brand-blue800 p-3">
        {review ? (
          <>
            <p>{t('send.savedUtxo.review')}</p>
            {review.outputs.map((output, index) => (
              <div key={index}>
                {output.script ? (
                  <details>
                    <summary>
                      {t(
                        output.script.kind === 'data'
                          ? 'transactions.opReturnData'
                          : 'transactions.outputScript'
                      )}
                    </summary>
                    <p className="break-all">{output.script.hex}</p>
                  </details>
                ) : (
                  <p className="break-all">{output.address}</p>
                )}
                {output.asset && (
                  <p>
                    {output.asset.assetGuid === SYSX_ASSET_GUID
                      ? `${formatSyscoinValue(output.asset.rawAmount)} SYSX`
                      : `${output.asset.rawAmount} ${t(
                          'transactions.replay.rawUnits'
                        )}`}
                    {' · '}
                    {t('send.assetGuid')} {output.asset.assetGuid}
                  </p>
                )}
                <p>
                  {formatSyscoinValue(output.amountSatoshis)} {symbol}
                </p>
              </div>
            ))}
            <p>
              {t('send.networkFee')} {formatSyscoinValue(review.feeSatoshis)}{' '}
              {symbol}
            </p>
            <button
              className={button}
              type="button"
              disabled={busy}
              onClick={() => {
                heldReview.current.id = undefined;
                setReview(undefined);
                run(async (owns) => {
                  await controllerEmitter(
                    ['wallet', 'confirmRetainedUtxoRetry'],
                    [review.id]
                  );
                  if (owns()) setStatus(t('notifications.submitted'));
                });
              }}
            >
              {t('transactions.replay.resend')}
            </button>
            <button
              className={button}
              type="button"
              disabled={busy}
              onClick={cancelReview}
            >
              {t('buttons.back')}
            </button>
          </>
        ) : (
          <>
            {saved.slice(0, limit).map(({ txid, accepted }) => (
              <button
                className={button}
                type="button"
                key={txid}
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  run(async (owns) => {
                    const state = await controllerEmitter(
                      ['wallet', 'checkRetainedUtxoTransfer'],
                      [txid]
                    );
                    if (!owns()) return;
                    setStatus(
                      state === 'confirmed'
                        ? t('notifications.confirmed')
                        : state === 'seen'
                        ? t('send.savedUtxo.seen')
                        : t('transactions.replay.unknown')
                    );
                    if (state === 'unknown') setSelected(txid);
                  });
                }}
              >
                {accepted
                  ? t('notifications.submitted')
                  : t('send.savedUtxo.check')}{' '}
                <span dir="ltr">{txid.slice(0, 8)}…</span>
              </button>
            ))}
            {saved.length > limit && (
              <button
                className={button}
                type="button"
                disabled={busy}
                onClick={() => setLimit(limit + 6)}
              >
                {t('buttons.loadMore')}
              </button>
            )}
            {!saved.length && !busy && <p>{t('send.savedUtxo.empty')}</p>}
            {selected && (
              <button
                className={button}
                type="button"
                disabled={busy}
                onClick={() => {
                  run(async (owns) => {
                    const next = (await controllerEmitter(
                      ['wallet', 'prepareRetainedUtxoRetry'],
                      [selected]
                    )) as Review;
                    if (owns()) {
                      heldReview.current.id = next.id;
                      setReview(next);
                    } else {
                      void controllerEmitter(
                        ['wallet', 'cancelRetainedUtxoRetry'],
                        [next.id]
                      ).catch(() => undefined);
                    }
                  });
                }}
              >
                {t('send.savedUtxo.review')}
              </button>
            )}
          </>
        )}
        <p role="status" aria-live="polite">
          {busy ? t('buttons.loading') : status}
        </p>
      </div>
    </details>
  );
}
