import React from 'react';

import { Icon } from '..';

interface IPrimaryButton {
  action?: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  ref?: (any) => void;
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
  ref,
  width = '36',
}) => {
  const enabledStyle = action
    ? 'border-warning-success bg-warning-success hover:bg-warning-successhover text-brand-white w-40'
    : `border-button-primary bg-button-primary hover:bg-button-primaryhover text-brand-white w-${width}`;

  const loadingIcon = <Icon name="loading" className="text-brand-white" />;

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
        ${disabled || loading ? 'button-disabled' : enabledStyle}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
      ref={ref}
    >
      {loading ? (
        loadingIcon
      ) : (
        <>
          {action && checkIcon}
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
  const actionStyle = action
    ? 'bg-transparent border-2 border-brand-white hover:bg-warning-error hover:border-warning-error hover:text-brand-white w-40'
    : 'border-button-secondary hover:bg-button-secondaryhover bg-button-secondary text-brand-white w-36 py-2.5';

  const loadingIcon = <Icon name="loading" className="text-brand-white" />;

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
      ${disabled || loading ? 'button-disabled' : actionStyle}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        loadingIcon
      ) : (
        <>
          {action && closeIcon}
          {children}
        </>
      )}
    </button>
  );
};
