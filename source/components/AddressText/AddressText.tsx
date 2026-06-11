import React, { FC, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from 'components/Icon';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/useUtils';
import { ellipsis } from 'utils/format';

/**
 * Canonical address display. Replaces the ad-hoc `ellipsis(addr, x, y)` +
 * copy-icon patterns scattered across pages with three shared presets:
 *
 *   short  - 4/4   (tight rows, badges)
 *   medium - 7/4   (default; matches the historical `ellipsis()` defaults)
 *   full   - no truncation
 *
 * The full value is always available via tooltip, and the optional copy
 * affordance reuses the shared clipboard hook + toast.
 */
export type AddressTextPreset = 'full' | 'medium' | 'short';

const PRESETS: Record<Exclude<AddressTextPreset, 'full'>, [number, number]> = {
  medium: [7, 4],
  short: [4, 4],
};

export interface IAddressText {
  className?: string;
  /** Show the copy icon + copy on click. Default true. */
  copyable?: boolean;
  /** Optional block-explorer URL; renders the address as a link. */
  explorerUrl?: string;
  id?: string;
  preset?: AddressTextPreset;
  /** Show full value in a tooltip (default true when truncated). */
  tooltip?: boolean;
  value: string;
}

export const AddressText: FC<IAddressText> = ({
  className = '',
  copyable = true,
  explorerUrl,
  id,
  preset = 'medium',
  tooltip = true,
  value,
}) => {
  const { t } = useTranslation();
  const { alert, useCopyClipboard } = useUtils();
  const [, copy] = useCopyClipboard();

  const display =
    preset === 'full' ? value : ellipsis(value, ...PRESETS[preset]);
  const isTruncated = display !== value;

  const handleCopy = useCallback(() => {
    copy(value);
    alert.info(t('home.addressCopied'));
  }, [alert, copy, t, value]);

  const text = explorerUrl ? (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:text-brand-royalbluemedium"
    >
      {display}
    </a>
  ) : (
    <span>{display}</span>
  );

  const body = (
    <span
      id={id}
      className={`inline-flex items-center gap-1 font-mono text-current ${className}`}
    >
      {tooltip && isTruncated ? (
        <Tooltip content={value}>{text}</Tooltip>
      ) : (
        text
      )}
      {copyable && (
        <button
          type="button"
          aria-label={t('buttons.copy')}
          onClick={handleCopy}
          className="inline-flex items-center text-brand-gray200 hover:text-brand-white transition-colors duration-200"
        >
          <Icon name="copy" size={12} isSvg />
        </button>
      )}
    </span>
  );

  return body;
};
