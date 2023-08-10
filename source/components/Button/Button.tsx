import React from 'react';

import { Icon } from '..';

interface IPrimaryButton {
  action?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  type: 'button' | 'submit' | 'reset' | undefined;
  width?: string;
}

interface IButton {
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  type: 'button' | 'submit' | 'reset' | undefined;
  useDefaultWidth?: boolean;
  width?: string;
}

export const Button: React.FC<IButton> = ({
  children,
  className = '',
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type,
  useDefaultWidth = true,
  width = '36',
}) => (
  <button
    className={`${className} ${useDefaultWidth && `w-${width}`}`}
    disabled={disabled || loading}
    onClick={onClick}
    type={type}
    id={id}
  >
    {children}
  </button>
);

export const PrimaryButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'submit',
  width = '36',
}) => {
  const checkIcon = (
    <Icon
      name="check-outlined"
      wrapperClassname="mb-0.5"
      className={disabled ? 'text-disabled' : 'text-brand-white'}
    />
  );

  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 w-${width} transition-all duration-300 h-10 rounded-full flex justify-center items-center gap-x-2 font-bold 
        ${
          disabled || loading
            ? 'opacity-60 cursor-not-allowed'
            : 'opacity-100 hover:bg-button-primaryhover'
        } border-button-primary bg-button-primary  text-brand-white w-${width}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <Icon
          name="loading"
          color="#4d76b8"
          className="w-6 animate-spin-slow"
        />
      ) : (
        <>
          {action && checkIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const SecondButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'submit',
  width = '36',
}) => {
  const closeIcon = (
    <Icon
      name="close"
      wrapperClassname="mb-0.5"
      className="text-brand-white font-bold"
    />
  );

  return (
    <button
      className={`tracking-normal cursor-pointer border-2 text-sm leading-4 w-${width} transition-all duration-300 h-10 rounded-full flex justify-center items-center gap-x-2 font-bold 
        ${
          disabled || loading
            ? 'opacity-60 cursor-not-allowed'
            : 'opacity-100 hover:bg-button-primaryhover'
        } border-button-primary  text-brand-white w-${width}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <Icon
          name="loading"
          color="#4d76b8"
          className="w-6 animate-spin-slow"
        />
      ) : (
        <>
          {action && closeIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const SecondaryButton: React.FC<IPrimaryButton> = ({
  action = false,
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type,
}) => {
  const closeIcon = (
    <Icon
      name="close"
      wrapperClassname="mb-0.5"
      className="text-brand-white font-bold"
    />
  );

  return (
    <button
      className={`
      flex justify-center rounded-full gap-x-2 items-center font-bold tracking-normal text-sm leading-4 w-36 h-10 text-brand-white
      ${
        disabled || loading
          ? 'opacity-60 cursor-not-allowed'
          : 'opacity-100 hover:bg-button-secondaryhover'
      } border-button-secondary  transition-all duration-300 bg-button-secondary text-brand-white w-36 py-2.5`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        <Icon
          name="loading"
          color="#4d76b8"
          className="w-6 animate-spin-slow"
        />
      ) : (
        <>
          {action && closeIcon}
          {children}
        </>
      )}
    </button>
  );
};

export const NeutralButton: React.FC<IPrimaryButton> = ({
  children,
  disabled = false,
  id = '',
  loading = false,
  onClick,
  type = 'button',
}) => (
  <button
    className={`
      flex justify-center rounded-full gap-x-2 items-center font-bold tracking-normal text-sm leading-4 w-36 h-10 text-brand-royalblue
      ${
        disabled || loading
          ? 'opacity-60 cursor-not-allowed'
          : 'opacity-100 hover:opacity-90'
      } border-button-neutral transition-all duration-300 bg-button-neutral w-36 py-2.5`}
    disabled={disabled || loading}
    onClick={onClick}
    type={type}
    id={id}
  >
    {loading ? (
      <Icon name="loading" color="#4d76b8" className="w-6 animate-spin-slow" />
    ) : (
      <>{children}</>
    )}
  </button>
);
