import React, { ReactNode } from 'react';

import { DialogPrimitive } from 'components/Dialog';

interface IModal {
  children: ReactNode;
  className?: string;
  onClose?: () => any;
  show?: boolean;
}

export const EditFeeModalBase = ({
  children,
  className = '',
  onClose,
  show = true,
}: IModal) => (
  <DialogPrimitive show={show} onClose={onClose} className={className}>
    {children}
  </DialogPrimitive>
);
