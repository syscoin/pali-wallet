import React, { FC, ReactElement } from 'react';
import MUITooltip from '@material-ui/core/Tooltip';

import styles from './Tooltip.scss';

interface ITooltip {
  title: string | ReactElement;
  children: ReactElement;
  arrow?: boolean;
  placement?:
    | 'bottom-end'
    | 'bottom-start'
    | 'bottom'
    | 'left-end'
    | 'left-start'
    | 'left'
    | 'right-end'
    | 'right-start'
    | 'right'
    | 'top-end'
    | 'top-start'
    | 'top';
}

const Tooltip: FC<ITooltip> = ({ title, children, arrow, placement }) => {
  return (
    <MUITooltip
      classes={{ tooltip: styles.tooltip, arrow: styles.arrow }}
      title={title}
      arrow={arrow}
      placement={placement}
    >
      {children}
    </MUITooltip>
  );
};

export default Tooltip;
