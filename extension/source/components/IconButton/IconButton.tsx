import React, { ReactNode, FC } from "react";
import { Button as AntButton } from "antd";

interface IIconButton {
  children: ReactNode;
  onClick?: any;
  type?: "primary" | "link" | "text" | "ghost" | "default" | "dashed" | undefined;
  shape?: "circle" | "round" | undefined;
  className?: string;
}

export const IconButton: FC<IIconButton> = ({
  children,
  type = "primary",
  onClick,
  shape = "circle",
  className = ""
}) => {
  return (
    <AntButton
      className={className}
      onClick={onClick}
      type={type}
      shape={shape}
    >
      {children}
    </AntButton>
  );
};
