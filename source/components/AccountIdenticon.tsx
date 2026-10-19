import { toSvg } from 'jdenticon';
import React, { useEffect, useRef } from 'react';

import { IKeyringAccountState } from 'types/network';

interface IAccountIdenticonProps {
  account?: Pick<IKeyringAccountState, 'address' | 'xpub'>;
  className?: string;
  size?: number;
}

export const AccountIdenticon = React.memo(
  ({
    account,
    className = 'add-identicon rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80',
    size = 40,
  }: IAccountIdenticonProps) => {
    const iconRef = useRef<HTMLDivElement>(null);
    const identifier = account?.xpub || account?.address || '';
    useEffect(() => {
      if (!iconRef.current || !identifier) return;
      iconRef.current.innerHTML = toSvg(identifier, size, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier, size]);
    return (
      <div
        ref={iconRef}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIdenticon.displayName = 'AccountIdenticon';
