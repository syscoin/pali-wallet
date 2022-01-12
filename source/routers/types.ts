import { RouteComponentProps } from 'react-router-dom';

interface SendMatchParams {
  address: string;
}

export type SendMatchProps = RouteComponentProps<SendMatchParams>;
