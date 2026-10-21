import Tippy from '@tippyjs/react';
import React, { ReactNode } from 'react';
import 'tippy.js/animations/scale.css';
import { Placement, ReferenceElement } from 'tippy.js';

interface ITooltip {
  children?: ReactNode;
  childrenClassName?: string;
  className?: string;
  content: ReactNode;
  focusable?: boolean;
  placement?: Placement | undefined;
}

export const Tooltip: React.FC<ITooltip> = ({
  children,
  childrenClassName,
  className,
  content,
  focusable,
  placement = 'top',
}) =>
  content ? (
    <Tippy
      animation="scale"
      placement={placement}
      appendTo={() => document.body}
      maxWidth="calc(100vw - 2rem)"
      interactive
      aria={focusable ? { content: 'describedby', expanded: false } : undefined}
      content={
        <div
          style={
            focusable ? { maxHeight: '50vh', overflowY: 'auto' } : undefined
          }
          className={`p-3 text-xs bg-bkg-1 border border-bkg-3 rounded-lg leading-5 shadow-md text-brand-white
          ${className} 
          ${
            String(content).length >= 20 &&
            'max-w-full whitespace-normal break-words'
          }`}
        >
          {content}
        </div>
      }
    >
      <div
        tabIndex={focusable ? 0 : undefined}
        className={`${
          focusable
            ? 'rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-white'
            : 'outline-none focus:outline-none'
        } ${childrenClassName}`}
        onKeyDown={
          focusable
            ? (event) => {
                const tooltip = (event.currentTarget as ReferenceElement)
                  ._tippy;
                if (!tooltip || !tooltip.state.isVisible) return;
                if (event.key === 'Escape') tooltip.hide();
                else {
                  const region = tooltip.popper.querySelector<HTMLElement>(
                    '.tippy-content > div > div'
                  );
                  if (!region) return;
                  const { scrollHeight, clientHeight } = region;
                  if (scrollHeight <= clientHeight) return;
                  const offset = {
                    ArrowUp: -40,
                    ArrowDown: 40,
                    PageUp: -clientHeight,
                    PageDown: clientHeight,
                    Home: -scrollHeight,
                    End: scrollHeight,
                  }[event.key];
                  if (offset === undefined) return;
                  region.scrollTop += offset;
                }
                event.preventDefault();
                event.stopPropagation();
              }
            : undefined
        }
      >
        {children}
      </div>
    </Tippy>
  ) : (
    <>{children}</>
  );
