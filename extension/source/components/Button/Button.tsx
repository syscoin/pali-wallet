import React, { ReactNode, FC } from 'react';
import clsx from 'clsx';
import MUIButton from '@material-ui/core/Button';
import { useHistory } from 'react-router-dom';
import Spinner from '@material-ui/core/CircularProgress';

import styles from './Button.scss';

interface IButton {
  blockHeight?: number;
  // height of block button if fullWidth = true
  children: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
  linkTo?: string;
  onClick?: () => void;
  theme?: 'primary' | 'secondary';
  type: 'button' | 'submit';
  variant?: string;
  loading?: boolean;
}

const Button: FC<IButton> = ({
  theme = 'primary',
  fullWidth = false,
  blockHeight = 0,
  children,
  disabled = false,
  variant = '',
  linkTo = '#',
  loading = false,
  ...otherProps
}) => {
  const classes = clsx(
    styles.button,
    styles[theme],
    {
      [styles.block]: fullWidth,
      [styles.disabled]: loading || disabled,
      [styles.loading]: loading,
    },
    variant
  );
  const customStyle = {
    height: fullWidth && blockHeight ? blockHeight : 'fit-content',
  };
  const history = useHistory();
  const clickHandler = () => {
    if (linkTo !== '#') history.push(linkTo);
  };

  return (
    <MUIButton
      className={classes}
      fullWidth={fullWidth}
      style={customStyle}
      onClick={clickHandler}
      disabled={loading || disabled}
      {...otherProps}
    >
      {loading && <Spinner classes={{ root: styles.spinner }} />}
      {children}
    </MUIButton>
  );
};

export default Button;
