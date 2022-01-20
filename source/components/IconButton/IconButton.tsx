import React, { ReactNode, FC } from 'react';
import { Button as AntButton } from 'antd';

interface IIconButton {
  children: ReactNode;
  className?: string;
  id: string;
  onClick?: any | undefined;
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
  id,
  type = 'primary',
  onClick = undefined,
  shape = 'circle',
  className = '',
}) => (
  <AntButton
    className={className}
    id={id}
    onClick={onClick}
    type={type}
    shape={shape}
  >
    {children}
  </AntButton>
);
