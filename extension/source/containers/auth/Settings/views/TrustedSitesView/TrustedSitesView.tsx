import { SecondaryButton } from "components/index";
import { AuthViewLayout } from "containers/common/Layout";
import React from "react";
import { useUtils, useFormat, useStore } from "hooks/index";
import { Form, Input } from 'antd';

const TrustedSitesView = () => {
  const { formatURL } = useFormat();
  const { history } = useUtils();
  const { trustedApps } = useStore();

  return (
    <AuthViewLayout title="TRUSTED WEBSITES">
      <p className="text-white text-sm m-4">
        Check all sites included on our trusted list.
      </p>

      <Form>
        <Form.Item>
          <Input.Search
            allowClear 
            defaultValue="26888888"
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col justify-center items-center w-full">
        <ul className="h-80 overflow-auto w-full p-2">
          {Object.values(trustedApps).map((url: string) => {
            return (
              <li className="my-2 p-2 border-b border-dashed border-brand-navyborder w-full text-xs">
                <p>{formatURL(url, 25)}</p>
              </li>
            )
          })}
        </ul>

        <div className="absolute bottom-12">
          <SecondaryButton
            type="button"
            onClick={() => history.push("/home")}
          >
            Close
          </SecondaryButton>
        </div>
      </div>
    </AuthViewLayout>
  );
};

export default TrustedSitesView;
