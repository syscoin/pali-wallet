import React, { ReactNode, FC } from 'react';

interface IButton {
  blockHeight?: number;
  children: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  linkTo?: string;
  loading?: boolean;
  onClick?: any;
  theme?:
    | 'primary'
    | 'secondary'
    | 'btn-outline-primary'
    | 'btn-gradient-primary'
    | 'btn-outline-secondary'
    | 'btn-rectangle-primary'
    | 'btn-rectangle-selected'
  type: 'button' | 'submit';
  variant?: string;
  className?: string;
}

export const Button: FC<IButton> = ({
  children,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  className = ""
  // className="py-2.5 px-12 rounded-full bg-brand-navy hover:bg-brand-primary"
}) => {
  return (
    <button
      className={className}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      { children }
    </button>
  );
};
