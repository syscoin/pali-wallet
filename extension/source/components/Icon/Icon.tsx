import React, { FC } from 'react';
import clsx from 'clsx';
import { OverridableComponent } from '@material-ui/core/OverridableComponent';
import { SvgIconTypeMap } from '@material-ui/core/SvgIcon';

import styles from './Icon.scss';

interface IIcon {
  Component: OverridableComponent<SvgIconTypeMap<{}, 'svg'>>;
  spaced?: boolean;
  variant?: string;
}

const Icon: FC<IIcon> = ({ Component, spaced = true, variant }) => {
  return (
    <div className={clsx(styles.icon, { [styles.spaced]: spaced }, variant)}>
      <Component />
    </div>
  );
};

export default Icon;
