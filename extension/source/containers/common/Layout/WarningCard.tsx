import { Card } from 'antd'
import React, { FC, ReactNode } from 'react'

interface IWarningCard {
    children: ReactNode;
}
export const WarningCard: FC<IWarningCard> = ({
    children,
  }) => {
    return (
        <div className="flex items-center justify-center pt-2">
            <Card className="w-full rounded text-brand-white border-dashed border border-light-blue-500 text-justify" style={{ width: 320}}>
             <div className="p-2">
                 <div className="text-sm pt-1">
                      <b>Warning:</b> {children}
                  </div>
             </div>
            </Card>
        </div>
    );
  };

  