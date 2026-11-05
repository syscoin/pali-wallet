import React, { useEffect, useRef, useState } from 'react';

import { useController } from 'hooks/useController';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';

type Saved = Readonly<{ accepted: boolean; txid: string }>;
type Review = Readonly<{
  feeSatoshis: string;
  id: string;
  outputs: readonly Readonly<{ address: string; amountSatoshis: string }>[];
}>;

export function SavedUtxoTransfers({ symbol }: { symbol: string }) {
  const { controllerEmitter } = useController();
  const [saved, setSaved] = useState<readonly Saved[]>([]);
  const [selected, setSelected] = useState<string>();
  const [review, setReview] = useState<Review>();
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(6);
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    []
  );
  const run = (work: (owns: () => boolean) => Promise<void>) => {
    const request = ++epoch.current,
      owns = () => request === epoch.current;
    setBusy(true);
    setStatus('');
    void work(owns)
      .catch(() => {
        if (owns()) setStatus('Pali could not verify the saved transfer.');
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
          setReview(undefined);
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
        Saved transfers
      </summary>
      <div className="flex flex-col gap-1 rounded-lg bg-brand-blue800 p-3">
        {review ? (
          <>
            <p>Review saved transfer</p>
            {review.outputs.map((output, index) => (
              <div key={index}>
                <p className="break-all">{output.address}</p>
                <p>
                  {formatSyscoinValue(output.amountSatoshis)} {symbol}
                </p>
              </div>
            ))}
            <p>
              Network fee {formatSyscoinValue(review.feeSatoshis)} {symbol}
            </p>
            <button
              className={button}
              type="button"
              disabled={busy}
              onClick={() => {
                setReview(undefined);
                run(async (owns) => {
                  await controllerEmitter(
                    ['wallet', 'confirmRetainedUtxoRetry'],
                    [review.id]
                  );
                  if (owns()) setStatus('Transfer submitted');
                });
              }}
            >
              Resend saved transfer
            </button>
            <button
              className={button}
              type="button"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Back
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
                        ? 'Transfer confirmed'
                        : state === 'seen'
                        ? 'Transfer seen on the network'
                        : 'Transfer status unverified'
                    );
                    if (state === 'unknown') setSelected(txid);
                  });
                }}
              >
                {accepted ? 'Submitted' : 'Check transfer'} {txid.slice(0, 8)}…
              </button>
            ))}
            {saved.length > limit && (
              <button
                className={button}
                type="button"
                disabled={busy}
                onClick={() => setLimit(limit + 6)}
              >
                Show more
              </button>
            )}
            {!saved.length && !busy && <p>No saved transfers</p>}
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
                    if (owns()) setReview(next);
                  });
                }}
              >
                Review saved transfer
              </button>
            )}
          </>
        )}
        <p role="status" aria-live="polite">
          {busy ? 'Working…' : status}
        </p>
      </div>
    </details>
  );
}
