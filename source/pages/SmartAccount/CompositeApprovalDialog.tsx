import { Dialog } from '@headlessui/react';
import {
  CubeIcon,
  FingerPrintIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@heroicons/react/outline';
import React, { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AddressText } from 'components/AddressText';
import {
  CenterPanel,
  DialogPrimitive,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogActions,
  DialogActionButton,
} from 'components/Dialog';
import { SmartAccountValidatorModule } from 'types/network';

export interface ICompositeApprovalValue {
  children: string[];
  threshold: number;
}

interface ICompositeApprovalDialogProps {
  candidates: SmartAccountValidatorModule[];
  onChange: (value: ICompositeApprovalValue) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  value: ICompositeApprovalValue;
}

const CompositeApprovalDialog = ({
  candidates,
  onChange,
  onClose,
  onSave,
  saving,
  value,
}: ICompositeApprovalDialogProps) => {
  const { t } = useTranslation();
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = new Set(value.children.map((child) => child.toLowerCase()));
  const selectedCandidates = candidates.filter((candidate) =>
    selected.has(candidate.address.toLowerCase())
  );
  const count = selectedCandidates.length;
  const thresholdValid =
    Number.isSafeInteger(value.threshold) &&
    value.threshold >= 1 &&
    value.threshold <= count;
  const selectionValid =
    selected.size === value.children.length && selected.size === count;
  const availableApprovals = selectedCandidates.filter(
    (candidate) => candidate.id !== 'custom' && candidate.id !== 'composite'
  ).length;
  const enoughLocalApprovals = availableApprovals >= value.threshold;
  const valid = selectionValid && thresholdValid && enoughLocalApprovals;
  const close = () => {
    if (!saving) onClose();
  };
  const summary = !count
    ? t('smartAccountHub.compositeSelectMethods')
    : !thresholdValid
    ? t('smartAccountHub.compositeInvalid')
    : count === 1
    ? t('smartAccountHub.compositeSingleRequired')
    : value.threshold === count
    ? t('smartAccountHub.compositeAllRequired', { count })
    : value.threshold === 1
    ? t('smartAccountHub.compositeAnyOne')
    : t('smartAccountHub.compositeThresholdSummary', {
        required: value.threshold,
        total: count,
      });

  return (
    <DialogPrimitive initialFocus={panelRef} onClose={close}>
      <CenterPanel
        aria-busy={saving}
        className="flex flex-col text-left focus:outline-none"
        padded={false}
        scroll={false}
        ref={panelRef}
        tabIndex={-1}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !saving) void onSave();
          }}
        >
          <DialogHeader
            title={t('settings.compositeAuthenticator')}
            icon={<ShieldCheckIcon />}
            onClose={close}
            disabled={saving}
          />

          <DialogBody className="space-y-5">
            <Dialog.Description className="text-sm leading-relaxed text-content-muted">
              {t('smartAccountHub.compositeBuilderHint')}
            </Dialog.Description>
            <fieldset className="space-y-2" disabled={saving}>
              <legend className="mb-3 text-sm font-medium text-content-primary">
                {t('smartAccountHub.compositeMethods')}
              </legend>
              {candidates.map((candidate, index) => {
                const checked = selected.has(candidate.address.toLowerCase());
                const name =
                  candidate.id === 'custom'
                    ? candidate.config.name
                    : t(
                        candidate.id === 'ecdsa'
                          ? 'settings.ecdsaAuthenticator'
                          : candidate.id === 'slh-dsa'
                          ? 'settings.slhDsaAuthenticator'
                          : 'settings.passkeyAuthenticator'
                      );
                const description = t(
                  candidate.id === 'ecdsa'
                    ? 'smartAccountHub.compositeEcdsaDescription'
                    : candidate.id === 'slh-dsa'
                    ? 'smartAccountHub.compositeSlhDescription'
                    : candidate.id === 'p256-webauthn'
                    ? 'smartAccountHub.compositePasskeyDescription'
                    : 'smartAccountHub.compositeCustomDescription'
                );
                const MethodIcon =
                  candidate.id === 'ecdsa'
                    ? KeyIcon
                    : candidate.id === 'slh-dsa'
                    ? ShieldCheckIcon
                    : candidate.id === 'p256-webauthn'
                    ? FingerPrintIcon
                    : CubeIcon;
                return (
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-content-primary focus-within:ring-offset-2 focus-within:ring-offset-surface-raised motion-reduce:transition-none ${
                      checked
                        ? 'border-accent-primary bg-surface-overlay'
                        : 'border-alpha-whiteAlpha300 bg-surface-base hover:border-content-muted'
                    } ${saving ? 'cursor-not-allowed opacity-60' : ''}`}
                    key={candidate.address}
                  >
                    <input
                      aria-describedby={`${id}-method-${index}-description`}
                      aria-labelledby={`${id}-method-${index}-name`}
                      checked={checked}
                      className="mt-1 h-5 w-5 shrink-0 cursor-inherit accent-accent-primary"
                      onChange={() => {
                        if (saving) return;
                        const children = checked
                          ? value.children.filter(
                              (child) =>
                                child.toLowerCase() !==
                                candidate.address.toLowerCase()
                            )
                          : [...value.children, candidate.address];
                        onChange({
                          children,
                          threshold: Math.min(
                            value.threshold,
                            Math.max(children.length, 1)
                          ),
                        });
                      }}
                      type="checkbox"
                    />
                    <MethodIcon
                      aria-hidden="true"
                      className="mt-0.5 h-6 w-6 shrink-0 text-content-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-sm font-medium text-content-primary"
                        id={`${id}-method-${index}-name`}
                      >
                        {name}
                      </span>
                      <span
                        className="mt-1 block text-xs leading-relaxed text-content-muted"
                        id={`${id}-method-${index}-description`}
                      >
                        {description}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-content-muted">
                        <span>
                          {t('smartAccountHub.compositeValidatorAddress')}
                        </span>
                        <AddressText
                          className="font-mono text-xs text-content-muted"
                          copyable={false}
                          preset="short"
                          value={candidate.address}
                        />
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <section className="space-y-3">
              <label
                className="block text-sm font-medium"
                htmlFor={`${id}-threshold`}
              >
                {t('smartAccountHub.compositeThreshold')}
              </label>
              <select
                aria-describedby={`${id}-rule`}
                className="h-11 w-full rounded-xl border border-alpha-whiteAlpha300 bg-surface-base px-3 text-sm text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving || count === 0}
                id={`${id}-threshold`}
                onChange={(event) => {
                  if (!saving)
                    onChange({
                      ...value,
                      threshold: Number(event.target.value),
                    });
                }}
                value={thresholdValid ? String(value.threshold) : ''}
              >
                {!thresholdValid && <option value="">—</option>}
                {Array.from({ length: count }, (_, index) => index + 1).map(
                  (required) => (
                    <option key={required} value={required}>
                      {required === count
                        ? t('smartAccountHub.compositeAllOption', { count })
                        : t('smartAccountHub.compositeThresholdOption', {
                            required,
                            total: count,
                          })}
                    </option>
                  )
                )}
              </select>
              <div
                aria-live="polite"
                className="rounded-xl bg-surface-base p-4 text-sm leading-relaxed"
                id={`${id}-rule`}
                role="status"
              >
                <span className="block font-medium">
                  {t('smartAccountHub.compositeRule')}
                </span>
                <span className="mt-1 block text-content-secondary">
                  {summary}
                </span>
                {count > 1 && thresholdValid && value.threshold === count && (
                  <span className="mt-2 block text-xs text-content-muted">
                    {t('smartAccountHub.compositeRecoveryHint')}
                  </span>
                )}
                {count > 0 && thresholdValid && !selectionValid && (
                  <span className="mt-2 block text-xs text-amber-300">
                    {t('smartAccountHub.compositeInvalid')}
                  </span>
                )}
                {thresholdValid && !enoughLocalApprovals && (
                  <span className="mt-2 block text-xs text-amber-300">
                    {t('smartAccountHub.compositeLockout')}
                  </span>
                )}
              </div>
            </section>
          </DialogBody>

          <DialogFooter>
            <p className="text-xs leading-relaxed text-content-muted">
              {t('smartAccountHub.compositeOnchainHint')}
            </p>
            <DialogActions>
              <DialogActionButton
                disabled={saving}
                fullWidth
                onClick={close}
                type="button"
                tone="secondary"
              >
                {t('buttons.cancel')}
              </DialogActionButton>
              <DialogActionButton
                disabled={!valid || saving}
                fullWidth
                type="submit"
              >
                {t(
                  saving
                    ? 'smartAccountHub.compositeSaving'
                    : 'smartAccountHub.compositeSavePolicy'
                )}
              </DialogActionButton>
            </DialogActions>
          </DialogFooter>
        </form>
      </CenterPanel>
    </DialogPrimitive>
  );
};

export default CompositeApprovalDialog;
