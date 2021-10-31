import React, { ReactNode, FC } from 'react';
// import clsx from 'clsx';
// import MUIButton from '@material-ui/core/Button';
import { useHistory } from 'react-router-dom';
// import Spinner from '@material-ui/core/CircularProgress';

// import styles from './Button.scss';

interface IButton {
  blockHeight?: number;
  children: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  linkTo?: string;
  loading?: boolean;
  onClick?: () => any;
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
}

const Button: FC<IButton> = ({
  children,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
}) => {
  return (
    <button
      className="tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light border border-brand-royalBlue hover:bg-brand-royalBlue hover:text-brand-navy transition-all duration-300"
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      { children }
    </button>
  );
};

export default Button;
