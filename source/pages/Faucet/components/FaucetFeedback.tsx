import React from 'react';

type FaucetFeedbackProps = {
  icon: string;
  textFeedbackDesc: string;
  textFeedbackTitle: string;
};
export const FaucetFeedback: React.FC<FaucetFeedbackProps> = ({
  icon,
  textFeedbackDesc,
  textFeedbackTitle,
}) => (
  <div className="flex flex-col items-center">
    <img className="w-[50px] h-[50px]" src={icon} />
    <h1 className="text-white text-sm text-center mt-6 mb-1">
      {textFeedbackTitle}
    </h1>
    <p className="text-brand-gray200 flex-wrap text-center max-w-[70%] text-xs">
      {textFeedbackDesc}
    </p>
  </div>
);
