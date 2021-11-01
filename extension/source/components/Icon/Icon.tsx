import React, { FC } from 'react';
import { OverridableComponent } from '@material-ui/core/OverridableComponent';
import { SvgIconTypeMap } from '@material-ui/core/SvgIcon';

interface IIcon {
  Component: OverridableComponent<SvgIconTypeMap<{}, 'svg'>>;
  spaced?: boolean;
  variant?: string;
}

const Icon: FC<IIcon> = ({ Component }) => {
  return (
    <div>
      <Component />
    </div>
  );
};

export default Icon;
