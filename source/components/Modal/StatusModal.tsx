import {
  CheckCircleIcon,
  ExclamationIcon,
  XCircleIcon,
} from '@heroicons/react/outline';
import React, { useCallback, useMemo, useRef } from 'react';

import {
  CenterPanel,
  DialogBody,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog/Dialog';

// Bottom status toast (success / error / warn), composed over the Dialog
// primitive with a transparent overlay so the page stays visible.

interface IModal {
  description?: string;
  onClose?: () => any;
  position?: string;
  show?: boolean;
  status: string;
  title: string;
}

export const StatusModal = ({
  description,
  onClose,
  show = true,
  title,
  position = 'inset-0',
  status = '',
}: IModal) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const theme = useMemo(() => {
    const themes = {
      error: {
        icon: <XCircleIcon className="text-brand-red" />,
        border: 'border-brand-red',
      },
      success: {
        icon: <CheckCircleIcon className="text-brand-green" />,
        border: 'border-brand-green',
      },
      warn: {
        icon: <ExclamationIcon className="text-brand-yellowInfo" />,
        border: 'border-brand-yellowInfo',
      },
    };

    return themes[status] || themes.warn;
  }, [status]);

  const handleOnClose = useCallback(() => {
    if (onClose) onClose();
  }, [onClose]);

  return (
    <DialogPrimitive
      presentation="sheet"
      overlay="transparent"
      zIndexClassName="z-[60]"
      className={position === 'inset-0' ? '' : position}
      onClose={handleOnClose}
      initialFocus={panelRef}
      show={show}
    >
      <CenterPanel
        ref={panelRef}
        tabIndex={-1}
        padded={false}
        scroll={false}
        className={`mb-4 flex flex-col border ${theme.border}`}
      >
        <DialogHeader title={title} icon={theme.icon} onClose={handleOnClose} />
        {description && (
          <DialogBody>
            <p>{description}</p>
          </DialogBody>
        )}
      </CenterPanel>
    </DialogPrimitive>
  );
};
