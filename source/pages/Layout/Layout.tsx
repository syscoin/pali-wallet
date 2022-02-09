import React, { ReactNode, FC } from 'react';
import { Header } from 'pages/Header';
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
  <div className="flex flex-col gap-4 items-center justify-center">
    <Header
      onlySection={onlySection}
      accountHeader={accountHeader}
      normalHeader={normalHeader}
    />

    <section>
      {tooltipText ? (
        <div className="flex gap-2 items-center justify-center">
          <span className="text-center text-brand-royalblue text-xl font-bold tracking-normal">
            {title}
          </span>

          <Tooltip content={tooltipText}>
            <QuestionCircleOutlined className="inline-flex w-3 text-brand-graylight text-sm" />
          </Tooltip>
        </div>
      ) : (
        <span className="text-center text-brand-royalblue text-xl font-bold tracking-normal">
          {title}
        </span>
      )}
    </section>

    <section>{children}</section>
  </div>
);
