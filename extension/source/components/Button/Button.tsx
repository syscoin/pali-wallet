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

const disabledStyle = "text-button-disabled opacity-50 cursor-not-allowed font-light border border-button-disabled";

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
      className={`${disabled || loading ? disabledStyle : 'text-brand-white cursor-pointer border border-button-primary bg-button-primary hover:bg-button-primaryhover'} tracking-normal text-sm leading-4 w-36 transition-all duration-300 rounded-full py-2.5 flex justify-center items-center font-bold`}
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

export const SecondaryButton: FC<IPrimaryButton> = ({
  children,
  disabled = false,
  loading = false,
  type,
  onClick,
  id='',
}) => {
  return (
    <button
      className={`${disabled || loading ? disabledStyle : 'text-brand-white cursor-pointer border border-button-secondary bg-button-secondary hover:bg-button-secondaryhover'} tracking-normal text-sm leading-4 w-36 transition-all duration-300 rounded-full py-2.5 flex justify-center items-center font-bold`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {children}
    </button>
  );
}
