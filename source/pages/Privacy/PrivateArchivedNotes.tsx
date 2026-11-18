import { Form } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  MAX_ARCHIVED_NOTES,
  PRIVATE_VAULT_ARCHIVE_BUDGET,
} from '../../wallet/privateVaultEnvelope';
import { Icon } from 'components/Icon';
import { ValidatedPasswordInput } from 'components/Input/ValidatedPasswordInput';
import type { IPrivateVaultArchiveView } from 'utils/privacy/privateVaultTypes';

import { readPrivateNote } from './usePrivateNotes';

const PAGE_SIZE = 20;
const actionClass =
  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-alpha-whiteAlpha300 bg-bkg-3 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-bkg-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50';
type Props = {
  controllerEmitter: (...args: any[]) => Promise<unknown>;
  onCount(count: number): void;
  onExport(): void;
  onRestored(): void;
  onReveal(id: string): void;
  revision: number;
};

function readArchive(value: unknown): IPrivateVaultArchiveView {
  const archive = value as IPrivateVaultArchiveView | null;
  if (
    !archive ||
    !Number.isSafeInteger(archive.limit) ||
    archive.limit < 1 ||
    archive.limit > MAX_ARCHIVED_NOTES ||
    archive.bundleLimitBytes !== PRIVATE_VAULT_ARCHIVE_BUDGET ||
    !Number.isSafeInteger(archive.storedBytes) ||
    archive.storedBytes < 0 ||
    archive.storedBytes > archive.bundleLimitBytes ||
    !Array.isArray(archive.notes) ||
    archive.notes.length > archive.limit
  )
    throw Error('privacy_vault_unavailable');
  const ids = new Set<string>();
  const notes = archive.notes.map((note) => {
    const known = readPrivateNote({ ...note, phase: 'waiting' });
    if (
      !known ||
      ids.has(known.id) ||
      !Number.isSafeInteger(note.archivedAt) ||
      note.archivedAt < 0
    )
      throw Error('privacy_vault_unavailable');
    ids.add(known.id);
    return {
      id: known.id,
      poolId: known.poolId,
      amount: known.amount,
      createdAt: known.createdAt,
      archivedAt: note.archivedAt,
    };
  });
  return { ...archive, notes };
}

/** Local encrypted inventory only. Restoring never authorizes a withdrawal. */
export default function PrivateArchivedNotes({
  controllerEmitter,
  revision,
  onCount,
  onRestored,
  onReveal,
  onExport,
}: Props) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [archive, setArchive] = useState<IPrivateVaultArchiveView>();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<
    { id: string; kind: 'restore' } | { kind: 'clear' }
  >();
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<
    { restored: true } | { removed: number }
  >();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const owner = useRef({ live: true, revision: 0, busy: false });
  const callbacks = useRef({ onCount, onRestored });
  callbacks.current = { onCount, onRestored };
  const current = (request: number) =>
    owner.current.live &&
    owner.current.revision === request &&
    document.visibilityState !== 'hidden';
  const refresh = useCallback(async () => {
    const request = ++owner.current.revision;
    setLoading(true);
    try {
      const value = readArchive(
        await controllerEmitter(
          ['privateVault', 'getArchivedNotes'],
          [],
          10000,
          false
        )
      );
      if (!current(request)) return;
      setArchive(value);
      setPage(0);
      callbacks.current.onCount(value.notes.length);
    } catch {
      if (current(request)) {
        setArchive(undefined);
        setError('privacy.archive.loadError');
      }
    } finally {
      if (current(request)) setLoading(false);
    }
  }, [controllerEmitter]);
  useEffect(() => {
    owner.current.live = true;
    return () => {
      owner.current.live = false;
      owner.current.revision++;
    };
  }, []);
  useEffect(() => {
    if (expanded) void refresh();
    else setArchive(undefined);
  }, [expanded, refresh, revision]);
  const close = () => {
    if (owner.current.busy) return;
    owner.current.revision++;
    setAction(undefined);
    setAcknowledged(false);
    setError(undefined);
    form.resetFields();
  };
  const choose = (next: typeof action) => {
    close();
    if (owner.current.busy) return;
    setAction(next);
    setResult(undefined);
  };
  const rows =
    archive?.notes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) || [];
  return (
    <section
      className="space-y-3 border-t border-alpha-whiteAlpha300 pt-3"
      aria-labelledby="privacy-archive-title"
    >
      <h2 id="privacy-archive-title" className="text-sm font-medium text-white">
        <button
          type="button"
          className={actionClass}
          disabled={pending}
          aria-expanded={expanded}
          aria-controls="privacy-archive-list"
          onClick={() => {
            if (!owner.current.busy) {
              close();
              setExpanded((value) => !value);
            }
          }}
        >
          <span aria-hidden="true">
            <Icon name="archive" size={18} />
          </span>
          {t('privacy.archive.title')}
          {archive ? ` (${archive.notes.length})` : ''}
          <span aria-hidden="true">
            <Icon name={expanded ? 'up' : 'down'} size={14} />
          </span>
        </button>
      </h2>
      {expanded && (
        <div id="privacy-archive-list" className="space-y-3 text-xs">
          <p className="text-brand-gray200">{t('privacy.archive.help')}</p>
          {archive && (
            <p>
              {t('privacy.archive.capacity', {
                count: archive.notes.length,
                limit: archive.limit,
              })}
            </p>
          )}
          {!action && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={actionClass}
                disabled={loading}
                onClick={() => {
                  setError(undefined);
                  void refresh();
                }}
              >
                <span aria-hidden="true">
                  <Icon name="reload" size={18} />
                </span>
                {t('privacy.refresh')}
              </button>
              <button
                type="button"
                className={actionClass}
                disabled={!archive?.notes.length || loading}
                onClick={onExport}
              >
                <span aria-hidden="true">
                  <Icon name="export" size={18} />
                </span>
                {t('privacy.bundle.exportTitle')}
              </button>
              <button
                type="button"
                className={actionClass}
                disabled={!archive?.notes.length || loading}
                onClick={() => choose({ kind: 'clear' })}
              >
                <span aria-hidden="true">
                  <Icon name="trash" size={18} />
                </span>
                {t('privacy.archive.clear')}
              </button>
            </div>
          )}
          {loading && <p role="status">{t('buttons.loading')}</p>}
          {!loading && archive && !archive.notes.length && (
            <p>{t('privacy.archive.empty')}</p>
          )}
          {!action && (
            <>
              <ul className="space-y-3">
                {rows.map((note) => (
                  <li
                    key={note.id}
                    className="rounded-lg border border-alpha-whiteAlpha300 p-3 space-y-2"
                  >
                    <p>
                      {t('privacy.archive.poolAmount', {
                        amount: note.amount,
                      })}{' '}
                      · {new Date(note.archivedAt).toLocaleDateString()}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={actionClass}
                        onClick={() => onReveal(note.id)}
                      >
                        <span aria-hidden="true">
                          <Icon name="eye" size={18} />
                        </span>
                        {t('privacy.revealNote')}
                      </button>
                      <button
                        type="button"
                        className={actionClass}
                        onClick={() => choose({ kind: 'restore', id: note.id })}
                      >
                        <span aria-hidden="true">
                          <Icon name="import" size={18} />
                        </span>
                        {t('privacy.archive.restore')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {archive && archive.notes.length > PAGE_SIZE && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    className={actionClass}
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <span aria-hidden="true">
                      <Icon name="arrow-left" size={18} />
                    </span>
                    {t('privacy.archive.previous')}
                  </button>
                  <span>
                    {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + rows.length} /{' '}
                    {archive.notes.length}
                  </span>
                  <button
                    type="button"
                    className={actionClass}
                    disabled={(page + 1) * PAGE_SIZE >= archive.notes.length}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <span aria-hidden="true">
                      <Icon name="details-forward" size={18} />
                    </span>
                    {t('buttons.next')}
                  </button>
                </div>
              )}
            </>
          )}
          {action && (
            <div
              className="space-y-3"
              role="group"
              aria-label={t(
                action.kind === 'clear'
                  ? 'privacy.archive.confirmClear'
                  : 'privacy.archive.restore'
              )}
            >
              <p className="font-medium">
                {t(
                  action.kind === 'clear'
                    ? 'privacy.archive.confirmClear'
                    : 'privacy.archive.restore'
                )}
              </p>
              {action.kind === 'clear' && (
                <>
                  <p>{t('privacy.archive.warning')}</p>
                  <label className="flex min-h-[44px] gap-3 items-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      disabled={pending}
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    {t('privacy.archive.confirmBackup')}
                  </label>
                </>
              )}
              {(action.kind === 'restore' || acknowledged) && (
                <Form
                  form={form}
                  className="[&_button]:min-h-[44px] [&_button]:min-w-[44px] [&_button]:rounded-xl [&_button]:border [&_button]:border-alpha-whiteAlpha300 [&_button]:px-3 [&_button]:text-sm"
                  autoComplete="off"
                  key={action.kind === 'restore' ? action.id : action.kind}
                >
                  <label
                    htmlFor="privacy-archive-password"
                    className="block mb-2"
                  >
                    {t('settings.enterYourPassword')}
                  </label>
                  <ValidatedPasswordInput
                    id="privacy-archive-password"
                    form={form}
                    validationTrigger="submit"
                    placeholder={t('settings.enterYourPassword')}
                    errorMessage={t(error || 'privacy.archive.actionError')}
                    onValidate={async (password) => {
                      const request = owner.current.revision;
                      if (
                        !current(request) ||
                        !archive ||
                        loading ||
                        owner.current.busy ||
                        (action.kind === 'clear' && !acknowledged)
                      )
                        throw Error('privacy_archive_cancelled');
                      owner.current.busy = true;
                      setPending(true);
                      setError(undefined);
                      try {
                        const value = await controllerEmitter(
                          [
                            'privateVault',
                            action.kind === 'restore'
                              ? 'restoreArchivedNote'
                              : 'clearArchive',
                          ],
                          action.kind === 'restore'
                            ? [action.id, password]
                            : [password],
                          30000,
                          false
                        );
                        if (!current(request)) return undefined;
                        if (
                          action.kind === 'clear' &&
                          (!value ||
                            typeof value !== 'object' ||
                            !Number.isSafeInteger(
                              (value as { removed: number }).removed
                            ) ||
                            (value as { removed: number }).removed < 0 ||
                            (value as { removed: number }).removed >
                              archive.limit)
                        )
                          throw Error('privacy_vault_unavailable');
                        return {
                          request,
                          result:
                            action.kind === 'restore'
                              ? { restored: true as const }
                              : {
                                  removed: (value as { removed: number })
                                    .removed,
                                },
                        };
                      } catch (failure) {
                        if (current(request)) {
                          setError(
                            failure instanceof Error &&
                              failure.message === 'privacy_note_limit'
                              ? 'privacy.archive.activeFull'
                              : 'privacy.archive.actionError'
                          );
                          callbacks.current.onRestored();
                          if (
                            !(
                              failure instanceof Error &&
                              [
                                'privacy_note_limit',
                                'Invalid password',
                              ].includes(failure.message)
                            )
                          ) {
                            setAction(undefined);
                            setAcknowledged(false);
                            form.resetFields();
                            void refresh();
                          }
                        }
                        // Do not pass controller errors to the shared input's logger.
                        throw Error('privacy_archive_action_failed');
                      } finally {
                        owner.current.busy = false;
                        if (owner.current.live) setPending(false);
                      }
                    }}
                    onValidationSuccess={(value) => {
                      if (!value || !current(value.request)) return;
                      setResult(value.result);
                      setAction(undefined);
                      setAcknowledged(false);
                      form.resetFields();
                      callbacks.current.onRestored();
                      void refresh();
                    }}
                  />
                </Form>
              )}
              <button
                type="button"
                className={actionClass}
                disabled={pending}
                onClick={close}
              >
                <span aria-hidden="true">
                  <Icon name="close" size={18} />
                </span>
                {t('buttons.cancel')}
              </button>
            </div>
          )}
          {result && (
            <p role="status">
              {t(
                'restored' in result
                  ? 'privacy.archive.restored'
                  : 'privacy.archive.clearResult',
                'removed' in result ? { count: result.removed } : {}
              )}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-brand-red">
          {t(error)}
        </p>
      )}
    </section>
  );
}
