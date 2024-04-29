import React from 'react';

type FaucedApiFeedbackProps = {
  apiResponse: string;
  apiTitle: string;
};
export const FaucetApiFeedback: React.FC<FaucedApiFeedbackProps> = ({
  apiTitle,
  apiResponse,
}) => (
  <div className="gap-1 w-[352px] h-[76px] flex flex-col mt-6 rounded-[20px] p-4 border border-dashed border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100">
    <h1 className="text-white text-sm">{apiTitle}</h1>
    <p className="text-white text-sm underline overflow-hidden">
      {apiResponse}
    </p>
  </div>
);
