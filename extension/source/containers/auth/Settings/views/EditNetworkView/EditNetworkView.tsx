import React from 'react';
import { AuthViewLayout } from 'containers/common/Layout/AuthViewLayout';

const EditNetworkView = ({ onSubmit, loading }) => {
  const handleSubmit = () => {
    onSubmit();
  }

  return (
    <div >
      <AuthViewLayout title="EDIT NETWORK">
        EDIT NETWORK CHILDREN
      </AuthViewLayout>
    </div>
  );
};

export default EditNetworkView;