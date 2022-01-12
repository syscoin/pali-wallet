import React, { ReactNode, FC } from "react";
import { Button as AntButton } from "antd";

interface IIconButton {
  children: ReactNode;
  className?: string;
  onClick?: any | undefined;
  shape?: "circle" | "round" | undefined;
  type?:
    | "primary"
    | "link"
    | "text"
    | "ghost"
    | "default"
    | "dashed"
    | undefined;
}

export const IconButton: FC<IIconButton> = ({
  children,
  type = "primary",
  onClick = undefined,
  shape = "circle",
  className = "",
}) => (
  <AntButton className={className} onClick={onClick} type={type} shape={shape}>
    {children}
  </AntButton>
);
