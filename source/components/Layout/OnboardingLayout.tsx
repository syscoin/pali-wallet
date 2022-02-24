import React, { ReactNode, FC } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { LogoHeader, Tooltip } from 'components/index';

interface IOnboardingLayout {
  children: ReactNode;
  title: string;
  tooltipText?: string;
}

export const OnboardingLayout: FC<IOnboardingLayout> = ({
  title,
  children,
  tooltipText = '',
}) => (
  <div className="flex flex-col gap-4 items-center justify-center">
    <LogoHeader />

    <section>
      <div className="flex gap-2 items-center justify-center">
        <span className="text-center text-brand-royalblue text-xl font-bold tracking-normal">
          {title}
        </span>

        <Tooltip content={tooltipText}>
          <QuestionCircleOutlined className="inline-flex w-3 text-brand-graylight text-sm" />
        </Tooltip>
      </div>
    </section>

    <section>{children}</section>
  </div>
);
