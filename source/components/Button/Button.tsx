import React, { memo } from 'react';

import { LoadingSvg } from 'components/Icon/Icon';

// ---------------------------------------------------------------------------
// Unified Button
//
// One component, one variant API:
//   variant: 'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger'
//            | 'unstyled' (default -- legacy generic <Button> behavior)
//   size:    'md' (default) | 'sm' | 'icon'
//
// Legacy dialects (PrimaryButton / SecondaryButton / NeutralButton / SecondButton)
// were migrated to <Button variant="..."> and deleted; IconButton is
// variant="ghost" size="icon".
// ---------------------------------------------------------------------------

// Width class mapping to ensure Tailwind includes these classes
const widthClasses: Record<string, string> = {
  '36': 'w-36',
  '40': 'w-40',
  '44': 'w-44',
  '48': 'w-48',
  '52': 'w-52',
  '56': 'w-56',
  '60': 'w-60',
  '64': 'w-64',
  full: 'w-full',
};

// Memoize loading icons to prevent unnecessary re-renders
const LoadingIconPrimary = memo(() => (
  <LoadingSvg className="w-6 animate-spin" style={{ color: '#4d76b8' }} />
));
LoadingIconPrimary.displayName = 'LoadingIconPrimary';

const LoadingIconWhite = memo(() => (
  <LoadingSvg className="w-5 animate-spin" style={{ color: '#ffffff' }} />
));
LoadingIconWhite.displayName = 'LoadingIconWhite';

export type ButtonVariant =
  | 'danger'
  | 'ghost'
  | 'neutral'
  | 'primary'
  | 'secondary'
  | 'unstyled';

export type ButtonSize = 'icon' | 'md' | 'sm';

export interface IButtonProps {
  children?: React.ReactNode;
  /** Extra classes appended after the variant classes. */
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Optional leading icon node (replaces the legacy `action` check/close). */
  icon?: React.ReactNode;
  id?: string;
  loading?: boolean;
  onClick?: () => any;
  size?: ButtonSize;
  type?: 'button' | 'reset' | 'submit';
  /** Legacy escape hatch used by variant="unstyled" call sites. */
  useDefaultWidth?: boolean;
  variant?: ButtonVariant;
  /** Legacy width key ('36'..'64' | 'full'); superseded by fullWidth. */
  width?: string;
}

const sizeClasses: Record<ButtonSize, string> = {
  md: 'h-10 text-sm',
  sm: 'h-8 text-xs',
  icon: 'h-10 w-10 p-0',
};

// Shared shell for every styled variant; matches the legacy dialect markup.
const baseStyled =
  'flex justify-center items-center gap-x-2 rounded-full font-bold tracking-normal leading-4 transition-all duration-200';

const enabledMotion = 'opacity-100 hover:scale-105 active:scale-95';
const disabledMotion = 'opacity-60 cursor-not-allowed';

const variantClasses: Record<
  Exclude<ButtonVariant, 'unstyled'>,
  { disabled: string; enabled: string; statics: string }
> = {
  primary: {
    statics:
      'cursor-pointer border-2 border-button-primary bg-button-primary text-brand-white',
    enabled: `${enabledMotion} hover:bg-button-primaryhover hover:shadow-lg`,
    disabled: disabledMotion,
  },
  secondary: {
    statics:
      'border-2 border-button-secondary bg-button-secondary text-brand-white',
    enabled: `${enabledMotion} hover:bg-button-secondaryhover hover:shadow-lg`,
    disabled: disabledMotion,
  },
  neutral: {
    statics: 'border-2 border-button-neutral bg-button-neutral',
    enabled: `${enabledMotion} hover:opacity-90 hover:shadow-md`,
    disabled: disabledMotion,
  },
  ghost: {
    statics: 'cursor-pointer border-2 border-button-primary text-brand-white',
    enabled: `${enabledMotion} hover:bg-button-primaryhover hover:shadow-lg`,
    disabled: disabledMotion,
  },
  danger: {
    statics: 'border-2 border-brand-red bg-brand-red text-brand-white',
    enabled: `${enabledMotion} hover:bg-brand-redDark hover:shadow-lg`,
    disabled: disabledMotion,
  },
};

export const Button: React.FC<IButtonProps> = ({
  children,
  className = '',
  disabled = false,
  fullWidth = false,
  icon,
  id = '',
  loading = false,
  onClick,
  size = 'md',
  type,
  useDefaultWidth = true,
  variant = 'unstyled',
  width = '36',
}) => {
  const isBlocked = disabled || loading;

  if (variant === 'unstyled') {
    // Legacy generic button: caller supplies all visual classes.
    return (
      <button
        className={`${className} ${
          useDefaultWidth ? widthClasses[width] || 'w-36' : ''
        } ${
          isBlocked ? disabledMotion : 'hover:scale-105 active:scale-95'
        } flex justify-center items-center transition-all duration-200`}
        disabled={isBlocked}
        onClick={onClick}
        type={type}
        id={id}
      >
        {loading ? <LoadingIconPrimary /> : children}
      </button>
    );
  }

  const palette = variantClasses[variant];
  const widthClass =
    size === 'icon' ? '' : fullWidth ? 'w-full' : widthClasses[width] || 'w-36';

  return (
    <button
      className={`${baseStyled} ${sizeClasses[size]} ${widthClass} ${
        palette.statics
      } ${isBlocked ? palette.disabled : palette.enabled} ${className}`}
      disabled={isBlocked}
      onClick={onClick}
      type={type}
      id={id}
    >
      {loading ? (
        variant === 'neutral' ? (
          <LoadingIconPrimary />
        ) : (
          <LoadingIconWhite />
        )
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
};
