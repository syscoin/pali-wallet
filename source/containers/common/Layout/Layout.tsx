import React, { ReactNode, FC } from 'react';
import { Header } from 'containers/common/Header';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Tooltip } from 'components/Tooltip';

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
}) => (
  <div className="flex flex-col justify-center gap-4 items-center">
    <Header
      onlySection={onlySection}
      accountHeader={accountHeader}
      normalHeader={normalHeader}
    />

    <section>
      {tooltipText ? (
        <div className="flex justify-center items-center gap-2">
          <span className="text-brand-royalblue font-bold text-xl text-center tracking-normal">
            {title}
          </span>

          <Tooltip content={tooltipText}>
            <QuestionCircleOutlined className="inline-flex text-sm text-brand-graylight w-3" />
          </Tooltip>
        </div>
      ) : (
        <span className="text-brand-royalblue font-bold text-xl text-center tracking-normal">
          {title}
        </span>
      )}
    </section>

    <section>{children}</section>
  </div>
);
