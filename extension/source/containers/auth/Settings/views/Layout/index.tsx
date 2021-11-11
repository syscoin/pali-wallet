import React, { FC } from 'react';
import Header from 'containers/common/Header';

interface IViewLayout {
  title: string;
  children: any;
}

const ViewLayout: FC<IViewLayout> = ({
  title,
  children
}) => {
  return (
    <div>
      <Header normalHeader />

      <div className="flex justify-center items-center bg-brand-gold py-4 px-2">
        {title}
      </div>

      {children}
    </div>
  );
};

export default ViewLayout;
