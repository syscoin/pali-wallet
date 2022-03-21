import React, { ReactNode, FC } from 'react';
import { Button as AntButton } from 'antd';

interface IIconButton {
  children: ReactNode;
  className?: string;
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
}) => (
  <AntButton
    className={className}
    id={id}
    onClick={onClick}
    shape={shape}
    type={type}
  >
    {children}
  </AntButton>
);
