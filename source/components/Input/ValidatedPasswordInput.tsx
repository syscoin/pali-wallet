import { Form, Input } from 'antd';
import { debounce } from 'lodash';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface IValidatedPasswordInputProps {
  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Debounce delay in milliseconds (defaults to 300)
   */
  debounceMs?: number;

  /**
   * Custom error message for wrong password
   */
  errorMessage?: string;

  /**
   * Form instance (optional, for external form control)
   */
  form?: any;

  /**
   * Input ID for testing/accessibility
   */
  id?: string;

  /**
   * Field name in the form (defaults to 'password')
   */
  name?: string;

  /**
   * Function to validate the password - should return the result or throw an error
   */
  onValidate: (password: string) => Promise<any>;

  /**
   * Callback when validation fails
   */
  onValidationError?: (error: any) => void;

  /**
   * Callback when validation succeeds
   */
  onValidationSuccess?: (result: any, password: string) => void;

  /**
   * Placeholder text for the input
   */
  placeholder?: string;

  /**
   * Whether the field is required (defaults to true)
   */
  required?: boolean;
}

export const ValidatedPasswordInput: React.FC<IValidatedPasswordInputProps> = ({
  onValidate,
  onValidationSuccess,
  onValidationError,
  placeholder,
  id,
  form,
  name = 'password',
  className = '',
  required = true,
  errorMessage,
  debounceMs = 300,
}) => {
  const { t } = useTranslation();

  // Validation states
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<
    'success' | 'error' | ''
  >('');

  // Use refs to store state values for stable access in callbacks
  const isValidatingRef = useRef(isValidating);
  const validationStatusRef = useRef(validationStatus);

  // Update state refs when state changes
  useEffect(() => {
    isValidatingRef.current = isValidating;
    validationStatusRef.current = validationStatus;
  }, [isValidating, validationStatus]);

  // Use refs to store callbacks to prevent useEffect recreation
  const onValidateRef = useRef(onValidate);
  const onValidationSuccessRef = useRef(onValidationSuccess);
  const onValidationErrorRef = useRef(onValidationError);
  const formRef = useRef(form);
  const nameRef = useRef(name);
  const errorMessageRef = useRef(errorMessage);
  const validationRunIdRef = useRef(0);

  // Update refs when props change
  useEffect(() => {
    onValidateRef.current = onValidate;
    onValidationSuccessRef.current = onValidationSuccess;
    onValidationErrorRef.current = onValidationError;
    formRef.current = form;
    nameRef.current = name;
    errorMessageRef.current = errorMessage;
  }, [
    onValidate,
    onValidationSuccess,
    onValidationError,
    form,
    name,
    errorMessage,
  ]);

  // Use ref to store the debounced function to prevent recreation
  const debouncedValidationRef = useRef<ReturnType<typeof debounce> | null>(
    null
  );

  // Create debounced validation function - only recreate when debounceMs changes
  useEffect(() => {
    const performValidation = async (password: string) => {
      if (!password) {
        setValidationStatus('');
        return;
      }

      // Mark this run as the latest. Any older async results should be ignored.
      const runId = ++validationRunIdRef.current;

      setIsValidating(true);
      setValidationStatus('');

      // Clear any previous error immediately so the UI doesn't flash red while validating
      if (formRef.current) {
        formRef.current.setFields([
          {
            name: nameRef.current,
            errors: [],
          },
        ]);
      }

      try {
        const result = await onValidateRef.current(password);

        // Ignore stale results (user typed again while this was running)
        if (runId !== validationRunIdRef.current) return;

        setValidationStatus('success');

        // Clear form field errors if form is provided
        if (formRef.current) {
          formRef.current.setFields([
            {
              name: nameRef.current,
              errors: [],
            },
          ]);
        }

        // Call success callback
        if (onValidationSuccessRef.current) {
          onValidationSuccessRef.current(result, password);
        }
      } catch (error) {
        console.error('Password validation error:', error);

        // Ignore stale errors (user typed again while this was running)
        if (runId !== validationRunIdRef.current) return;

        setValidationStatus('error');

        // Set form field error if form is provided
        if (formRef.current) {
          formRef.current.setFields([
            {
              name: nameRef.current,
              errors: [errorMessageRef.current || t('start.wrongPassword')],
            },
          ]);
        }

        // Call error callback
        if (onValidationErrorRef.current) {
          onValidationErrorRef.current(error);
        }
      } finally {
        // Only the latest run should control the loading state
        if (runId === validationRunIdRef.current) {
          setIsValidating(false);
        }
      }
    };

    // Create debounced function
    debouncedValidationRef.current = debounce(performValidation, debounceMs);

    // Cleanup function to cancel any pending debounced calls
    return () => {
      if (debouncedValidationRef.current) {
        debouncedValidationRef.current.cancel();
        debouncedValidationRef.current = null;
      }
    };
  }, [debounceMs, t]); // Only depend on debounceMs and t

  // Handle password input change
  const handlePasswordChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      // Only clear validation state visually, don't touch form fields here
      if (validationStatusRef.current) {
        setValidationStatus('');
      }

      if (value.trim() && debouncedValidationRef.current) {
        // Only set loading if we're not already validating
        if (!isValidatingRef.current) {
          setIsValidating(true);
        }
        debouncedValidationRef.current(value);
      } else {
        // Only update state if it's different
        if (isValidatingRef.current) {
          setIsValidating(false);
        }
        if (validationStatusRef.current) {
          setValidationStatus('');
        }
      }
    },
    []
  ); // No dependencies since we use refs

  return (
    <Form.Item
      name={name}
      className={`w-full md:max-w-md ${className}`}
      hasFeedback
      validateStatus={isValidating ? 'validating' : validationStatus || ''}
      rules={[
        {
          required,
          message: placeholder || t('settings.enterYourPassword'),
        },
      ]}
    >
      <Input
        type="password"
        className="custom-import-input relative"
        placeholder={placeholder || t('settings.enterYourPassword')}
        id={id}
        onChange={handlePasswordChange}
      />
    </Form.Item>
  );
};

export default ValidatedPasswordInput;
