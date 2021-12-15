import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';

interface IEditNetworks {}
const EditNetworks: FC<IEditNetworks> = ({}) => {
  return (
    <div>
      <AuthViewLayout title="EDIT NETWORKS"> </AuthViewLayout>
      <div className="flex flex-col gap-1 pt-4 p-4">
        <p className="text-white text-sm">Click on network to edit</p>
        <div className="pt-3">
          <div className="border-dashed border-b border-gray-100 border-opacity-10 text-white pb-3">
            <p className="text-base">Testttttt network</p>
            <p className="text-sm text-brand-royalBlue">Blockbook URL: https://blockbook.allntei9iedi9.com</p>
          </div>
        </div>
        <div className="pt-3">
          <div className="border-dashed border-b border-gray-100 border-opacity-10 text-white pb-3">
            <p className="text-base">Elizandra Network</p>
            <p className="text-sm text-brand-royalBlue">Blockbook URL: https://blockbook.loremipsum.com</p>
          </div>
        </div>
        <div className="pt-3">
          <div className="border-dashed border-b border-gray-100 border-opacity-10 text-white pb-3">
            <p className="text-base">Testttttt network</p>
            <p className="text-sm text-brand-royalBlue">Blockbook URL: https://blockbook.test123.com</p>
          </div>
        </div>
      </div>
    </div>
  );
};
export default EditNetworks;
