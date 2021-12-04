import { Card } from 'antd'
import React, { FC, ReactNode } from 'react'

interface IWarningCard {
    children: ReactNode;
    className?: string;
    warningText?: string;
    warningClassName?: string;
}
export const WarningCard: FC<IWarningCard> = ({
    children,
    className = "",
    warningText = "",
    warningClassName = "",
  }) => {
    return (
        <div className="flex items-center justify-center pt-2">
            <Card className={className} style={{ width: 320}}>
             <div className="p-2">
                 <div className="text-sm p-2">
                      <b className={warningClassName}>{warningText}</b> 
                      {children}
                  </div>
             </div>
            </Card>
        </div>
    );
  };

  