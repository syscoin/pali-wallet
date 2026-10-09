import { Dispatch, SetStateAction, useState } from 'react';

/** Do not render a previous account/network's local state even for one frame. */
export const useContextualState = <T>(
  context: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] => {
  const [stored, setStored] = useState({ context, value: initial });
  const value = stored.context === context ? stored.value : initial;
  const setValue: Dispatch<SetStateAction<T>> = (update) =>
    setStored((previous) => ({
      context,
      value:
        typeof update === 'function'
          ? (update as (previousValue: T) => T)(
              previous.context === context ? previous.value : initial
            )
          : update,
    }));
  return [value, setValue];
};
