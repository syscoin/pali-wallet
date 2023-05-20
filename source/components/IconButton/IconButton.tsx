import { Button as AntButton } from 'antd';
import React, { ReactNode, FC } from 'react';

interface IIconButton {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onClick?: () => any;
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
  shape = 'circle',
  type = 'primary',
  disabled = false,
}) => (
  <AntButton
    className={className}
    id={id}
    onClick={onClick}
    shape={shape}
    type={type}
    disabled={disabled}
  >
    {children}
  </AntButton>
);
