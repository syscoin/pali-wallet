import React, { ReactNode } from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/animations/scale.css';

interface ITooltip {
  children?: ReactNode;
  childrenClassName?: string;
  className?: string;
  content: ReactNode;
}

export const Tooltip: React.FC<ITooltip> = ({
  children,
  childrenClassName,
  className,
  content,
}) => (
  <Tippy
    animation="scale"
    placement="top"
    appendTo={document.body}
    maxWidth="20rem"
    interactive
    content={
      <div
        className={`p-3 text-xs bg-bkg-1 border border-bkg-3 rounded-lg leading-5 shadow-md text-brand-white outline-none focus:outline-none ${className}`}
      >
        {content}
      </div>
    }
  >
    <div className={`outline-none focus:outline-none ${childrenClassName}`}>
      {children}
    </div>
  </Tippy>
);
