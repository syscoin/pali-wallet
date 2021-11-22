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
  standardClass?: string;
  className?: string;
  noStandard?: boolean;
}

export const Button: FC<IButton> = ({
  children,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  className = "",
  standardClass = "tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer font-light border border-brand-white transition-all duration-300 bg-gradient-to-r from-blue-500 via-pink-500 to-green-500 tracking-normal text-base rounded-full hover:from-pink-500 hover:via-green-500 hover:to-yellow-500",
  noStandard = false,
}) => {
  return (
    <button
      className={noStandard ? className : `${className} ${standardClass}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      { children }
    </button>
  );
};
