import React, { ReactNode, FC } from 'react';
import Header from 'containers/common/Header';

interface ILayout {
  children: ReactNode;
  linkTo?: string;
  showLogo?: boolean;
  title: string;
  importSeed?: boolean;
  onlySection?: boolean;
  accountHeader?: boolean;
  normalHeader?: boolean;
}

const Layout: FC<ILayout> = ({
  title,
  // linkTo = '#',
  // showLogo = false,
  children,
  // importSeed = false,
  onlySection = false,
  accountHeader = false,
  normalHeader = false,
}) => {
  return (
    <div className="flex flex-col justify-center items-center">
      <Header
        onlySection={onlySection}
        accountHeader={accountHeader}
        normalHeader={normalHeader}
      />

      <section>
        <span className="text-brand-royalBlue font-bold text-xl text-center tracking-normal">{title}</span>
      </section>
      <section >{children}</section>
    </div>
  );
};

export default Layout;
