import React, { ReactNode, FC } from 'react';
import clsx from 'clsx';
import { Link as RouterLink } from 'react-router-dom';

import styles from './Link.scss';

interface ILink {
  children: ReactNode;
  color?: 'primary' | 'secondary';
  noUnderline?: boolean;
  onClick?: () => void;
  to: string;
}

const Link: FC<ILink> = ({
  to,
  color = 'primary',
  children,
  noUnderline = false,
  onClick,
}) => {
  const classes = clsx(styles.link, styles[color], {
    [styles.noUnderline]: noUnderline,
  });

  return (
    <RouterLink className={classes} to={to} onClick={onClick}>
      {children}
    </RouterLink>
  );
};

export default Link;
