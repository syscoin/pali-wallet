import React, { FC } from 'react';
import { Icon, IconButton } from 'components/index';
import { Header } from '../Header';
import { useUtils } from 'hooks/useUtils';

interface IAuthViewLayout {
  title: string;
  children: any
}

export const AuthViewLayout: FC<IAuthViewLayout> = ({
  title,
  children
}) => {
  const { history } = useUtils();

  return (
    <>
      <Header normalHeader />

      <div className="w-full flex justify-center items-center text-brand-white bg-brand-navyborder p-6 relative">
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
    </>
  );
};
