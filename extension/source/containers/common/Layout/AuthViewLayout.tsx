import React, { FC } from 'react';
import { Icon, IconButton } from 'components/index';
import { Header } from '../Header';
import { useUtils } from 'hooks/useUtils';

interface IAuthViewLayout {
  title: string;
  children: any;
  background?: string;
  canGoBack?: boolean;
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children,
  background = 'bg-brand-navydarker',
  canGoBack = true,
}) => {
  const { history } = useUtils();

  return (
    <div className={`${background} w-full bg-brand-navydarker h-popup text-brand-white`}>
      <Header normalHeader />

      <div className={`w-full flex justify-center items-center text-brand-white  p-6 relative bg-brand-navyborder`}>
        <p className="text-xl max-w-sm flex-1 text-center">{title}</p>

        {canGoBack && (
          <IconButton
            onClick={() => history.push('/home')}
          >
            <Icon name="close" />
          </IconButton>
        )}
      </div>

      <div className={`${background} text-brand-white`}>
        {children}
      </div>
    </div>
  );
};
