import React, { FC, ReactNode } from 'react';

// Legacy icon-button shim.
//
// Historically this wrapped antd's <Button shape="circle"> -- but the antd
// stylesheet is not loaded, so it always rendered as a bare button whose
// look came entirely from the caller's className. The shim keeps that exact
// contract without the antd dependency. New code should use
// <Button variant="unstyled" size="icon"> (or "ghost") from components/Button.
interface IIconButton {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onClick?: () => any;
  /** Kept for call-site compatibility; purely decorative legacy props. */
  shape?: 'circle' | 'round' | undefined;
  type?:
    | 'primary'
    | 'link'
    | 'text'
    | 'ghost'
    | 'default'
    | 'dashed'
    | undefined;
}

export const IconButton: FC<IIconButton> = ({
  children,
  className = '',
  id = '',
  onClick,
  disabled = false,
}) => (
  <button
    type="button"
    className={`cursor-pointer disabled:cursor-not-allowed ${className}`}
    id={id}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);
