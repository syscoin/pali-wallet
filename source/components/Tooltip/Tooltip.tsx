import React, { ReactNode } from "react";
import Tippy from "@tippyjs/react";
import "tippy.js/animations/scale.css";

type TooltipProps = {
  children?: ReactNode;
  className?: string;
  content: ReactNode;
  contentClassName?: string;
  placement?: any;
};

export const Tooltip = ({
  children,
  content,
  className,
  contentClassName,
  placement = "top",
}: TooltipProps) =>
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
      <div className={`outline-none focus:outline-none ${contentClassName}`}>
        {children}
      </div>
    </Tippy>
  ) : (
    <>{children}</>
  );
