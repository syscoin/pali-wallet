import React, { ReactNode, FC } from 'react';
import { Link as RouterLink } from 'react-router-dom';

interface ILink {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  to: string;
}

export const Link: FC<ILink> = ({
  to,
  className = "no-underline font-medium text-base font-poppins",
  children,
  onClick,
}) => {
  return (
    <RouterLink className={className} to={to} onClick={onClick}>
      {children}
    </RouterLink>
  );
};
