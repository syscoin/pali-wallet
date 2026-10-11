import React, { ReactNode, FC } from 'react';

import { QuestionCircleOutlined } from 'components/Icon/Icon';
import { LogoHeader, Tooltip } from 'components/index';

interface IOnboardingLayout {
  children: ReactNode;
  scrollable?: boolean;
  title: string;
  tooltipText?: string;
}

export const OnboardingLayout: FC<IOnboardingLayout> = ({
  title,
  children,
  scrollable = false,
  tooltipText,
}) => (
  <div
    className={`flex flex-col gap-4 items-center md:pt-20 bg-gradient ${
      scrollable ? 'h-screen min-h-0 overflow-y-auto' : 'h-full'
    }`}
  >
    <div
      className={`w-full h-max bg-no-repeat bg-[url('../../../source/assets/all_assets/Dots.png')] flex flex-col items-center md:pt-20 z-20 ${
        scrollable ? 'shrink-0' : ''
      }`}
    >
      <LogoHeader />

      <section>
        <div className="flex gap-2 items-center justify-center pb-8">
          <h1 className="text-center text-brand-royalblue text-xl font-bold tracking-normal">
            {title}
          </h1>

          {tooltipText && (
            <Tooltip content={tooltipText}>
              <QuestionCircleOutlined className="inline-flex w-3 text-brand-graylight text-sm" />
            </Tooltip>
          )}
        </div>
      </section>

      <section className="flex flex-col items-center w-full max-w-md px-6">
        {children}
      </section>
    </div>{' '}
  </div>
);
