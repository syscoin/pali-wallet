let inputProps: any;

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: (effect: () => void) => effect(),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('antd', () => {
  const React = jest.requireActual('react');
  return {
    Form: {
      Item: ({ children }: any) => children,
    },
    Input: (props: any) => {
      inputProps = props;
      return React.createElement('div', null, props.suffix);
    },
  };
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ValidatedPasswordInput } from './ValidatedPasswordInput';

describe('ValidatedPasswordInput explicit validation', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    inputProps = undefined;
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('does not validate partial passwords while typing', async () => {
    const onValidate = jest.fn().mockResolvedValue('seed words');
    const onValidationSuccess = jest.fn();
    const markup = renderToStaticMarkup(
      <ValidatedPasswordInput
        onValidate={onValidate}
        onValidationSuccess={onValidationSuccess}
        validationTrigger="submit"
      />
    );

    inputProps.onChange({ target: { value: 'partial-password' } });
    await Promise.resolve();

    expect(onValidate).not.toHaveBeenCalled();
    expect(markup).toContain('buttons.confirm');

    inputProps.onPressEnter({ preventDefault: jest.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onValidate).toHaveBeenCalledWith('partial-password');
    expect(onValidationSuccess).toHaveBeenCalledWith(
      'seed words',
      'partial-password'
    );
  });

  it('shows the persisted lockout duration instead of a wrong-password error', async () => {
    const lockoutError = new Error(
      'Too many failed attempts. Please wait 240 seconds before trying again.'
    );
    const form = { setFields: jest.fn() };
    renderToStaticMarkup(
      <ValidatedPasswordInput
        form={form}
        onValidate={jest.fn().mockRejectedValue(lockoutError)}
        validationTrigger="submit"
      />
    );

    inputProps.onChange({ target: { value: 'password' } });
    inputProps.onPressEnter({ preventDefault: jest.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(form.setFields).toHaveBeenLastCalledWith([
      {
        errors: [lockoutError.message],
        name: 'password',
      },
    ]);
  });
});
