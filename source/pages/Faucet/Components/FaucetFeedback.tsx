import React from 'react';

type FaucedFeedbackProps = {
  icon: string;
  textFeedbackDesc: string;
  textFeedbackTitle: string;
};
export const FaucetFeedback: React.FC<FaucedFeedbackProps> = ({
  icon,
  textFeedbackDesc,
  textFeedbackTitle,
}) => (
  <div className="flex flex-col items-center">
    <img src={icon} />
    <h1 className="text-white text-sm text-center mt-6 mb-1">
      {textFeedbackTitle}
    </h1>
    <p className="text-brand-gray200 text-xs">{textFeedbackDesc}</p>
  </div>
);
