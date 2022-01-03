import React, { FC } from 'react';
import { Icon } from '..';

type IPrimaryButton = {
  children: any;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  type: "button" | "submit" | "reset" | undefined;
  onClick?: any;
}

export const Button = ({
  children,
  id = '',
  disabled = false,
  loading = false,
  type,
  onClick,
  className = "",
}) => {
  return (
    <button
      id={id}
      className={className}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
};

const disabledStyle = "text-brand-white opacity-50 cursor-not-allowed font-light border border-brand-gray bg-brand-navyborder";

export const PrimaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  id = '',
}) => {
  return (
    <button
      className={`${disabled || loading ? disabledStyle : 'text-brand-white cursor-pointer border border-brand-royalBluemedium bg-brand-royalBluemedium hover:border-brand-royalBlue'} tracking-normal text-sm leading-4 w-36 font-light transition-all duration-300 rounded-full py-2.5 flex justify-center items-center`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <Icon name="loading" className="text-brand-white" />
      ) : children}
    </button>
  );
}

export const SecondaryButton = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  id='',
}) => {
  return (
    <button
      className="text-brand-white tracking-normal text-sm leading-4 w-36 cursor-pointer font-light transition-all duration-300 rounded-full border border-brand-royalBlue bg-brand-navydarker hover:border-brand-royalBluemedium py-2.5"
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {children}
    </button>
  );
}
