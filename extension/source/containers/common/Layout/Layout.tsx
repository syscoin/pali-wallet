import React, { ReactNode, FC } from 'react';
// import Header from 'containers/common/Header';

interface ILayout {
  children: ReactNode;
  linkTo?: string;
  showLogo?: boolean;
  title: string;
  importSeed?: boolean;
}

const Layout: FC<ILayout> = ({
  title,
  linkTo = '#',
  showLogo = false,
  children,
  importSeed = false,
}) => {
  return (
    <>
      {/* <Header backLink={linkTo} showLogo={showLogo} importSeed={importSeed} /> */}
      <div>
        <section>
          <span className="heading-1">{title}</span>
        </section>
        <section >{children}</section>
      </div>
    </>
  );
};

export default Layout;
