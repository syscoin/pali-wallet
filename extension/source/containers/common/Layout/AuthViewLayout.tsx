import React, { FC } from 'react';
import { Icon, IconButton } from 'components/index';
import { Header } from '../Header';
import { useUtils } from 'hooks/useUtils';

interface IAuthViewLayout {
  title: string;
  children: any;
  background?: string;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children,
  background = 'bg-brand-navydarker'
}) => {
  const { history } = useUtils();

  return (
    <div className={`${background} bg-brand-navydarker w-full h-full`}>
      <Header normalHeader />

      <div className={`w-full flex justify-center items-center text-brand-white  p-6 relative bg-brand-navyborder`}>
        <p className="text-xl max-w-sm flex-1 text-center">{title}</p>

        <IconButton
          onClick={() => history.push('/home')}
        >
          <Icon name="close" wrapperClassname="flex 1" />
        </IconButton>
      </div>

      <div className="text-brand-white">
        {children}
      </div>
    </div>
  );
};
