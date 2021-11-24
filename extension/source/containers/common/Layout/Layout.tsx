import React, { ReactNode, FC, useEffect } from 'react';
import { Header } from 'containers/common/Header';
import { Tooltip } from 'antd';
import { Icon } from 'components/index';

interface ILayout {
  accountHeader?: boolean;
  children: ReactNode;
  importSeed?: boolean;
  normalHeader?: boolean;
  onlySection?: boolean;
  title: string;
  tooltipText?: string;
}

export const Layout: FC<ILayout> = ({
  title,
  children,
  onlySection = false,
  accountHeader = false,
  normalHeader = false,
  tooltipText = '',
}) => {
  useEffect(() => {
    console.log('tooltip', tooltipText)
  }, [tooltipText])

  return (
    <div className="flex flex-col justify-center items-center">
      <Header
        onlySection={onlySection}
        accountHeader={accountHeader}
        normalHeader={normalHeader}
      />

      <section>
        {tooltipText ? (
          <div className="flex justify-center items-center gap-2">
            <span className="text-brand-royalBlue font-bold text-xl text-center tracking-normal">
              {title}
            </span>

            <Tooltip placement="bottom" title={tooltipText}>
              <Icon name="question" className="inline-flex self-center text-base text-brand-graylight w-3" />
            </Tooltip>
          </div>
        ) : (
          <span className="text-brand-royalBlue font-bold text-xl text-center tracking-normal">
            {title}
          </span>
        )}
      </section>
      <section>{children}</section>
    </div>
  );
};
