import { Card } from 'antd'
import { Icon } from 'components/Icon';
import React, { FC } from 'react'

interface IAddresCard {
    title: string;
    account: string;
}
export const AddresCard: FC<IAddresCard> = ({
    title,
    account
  }) => {
    return (
        <div className="flex items-center justify-center pt-4">
            <Card className="w-full rounded text-brand-white bg-brand-deepPink" style={{ width: 320, border: '1px'}}>
             <div className="p-4">
                <div className="flex text-brand-white">
                    <p className="text-base">{title}</p>
                 </div>
                 <div className="inline-flex text-base pt-1" >
                  <p className="text-base">{account} </p>
                  <Icon name="copy" className="pl-8 inline-flex self-center text-base" />
                </div>
             </div>
            </Card>
    </div>
    );
  };

  