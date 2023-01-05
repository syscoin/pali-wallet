import Tippy from '@tippyjs/react';
import React, { ReactElement, ReactNode } from 'react';
import 'tippy.js/animations/scale.css';
import { Placement } from 'tippy.js';

interface ITooltip {
  children: ReactElement;
  className?: string;
  content: ReactNode;
  placement?: Placement | undefined;
}

export const Tooltip: React.FC<ITooltip> = ({
  children,
  className,
  content,
  placement = 'top',
}) =>
  content ? (
    <Tippy
      animation="scale"
      placement={placement}
      appendTo={() => document.body}
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
      {children}
    </Tippy>
  ) : (
    children
  );
