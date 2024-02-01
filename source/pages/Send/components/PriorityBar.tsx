import React, { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

export const WhiteBall = () => (
  <div className="w-3 h-3 bg-white border-2 border-white rounded-full" />
);

export const Ball = ({
  label,
  selected,
}: {
  label: string;
  selected?: boolean;
}) => (
  <div className="relative flex flex-col items-center justify-center w-5 cursor-pointer">
    <div className="p-0.4 flex items-center justify-center w-5 h-5 bg-transparent border-2 border-brand-blue400 rounded-full">
      {selected && <WhiteBall />}
    </div>

    <div className="h-5 text-center bg-transparent border-l-2 border-brand-blue400" />

    <p
      className={`${
        selected ? 'text-white' : 'text-brand-gray200'
      } absolute -bottom-6 text-xs`}
    >
      {label}
    </p>
  </div>
);

export const PriorityBar = ({
  priority,
  onClick,
}: {
  onClick: Dispatch<SetStateAction<number>>;
  priority: number;
}) => {
  const { t } = useTranslation();
  const values = {
    0: t('send.low'),
    1: t('send.medium'),
    2: t('send.high'),
  };

  return (
    <div className="flex items-center justify-between w-60 max-w-xs border-b-2 border-brand-blue400">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} onClick={() => onClick(Number(key))}>
          <Ball selected={Number(key) === priority} label={value} />
        </div>
      ))}
    </div>
  );
};
