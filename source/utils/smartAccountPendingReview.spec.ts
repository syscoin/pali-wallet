import { isSmartAccountPendingReviewError } from './smartAccountErrors';

it.each([
  new Error('SMART_ACCOUNT_PENDING_STATE'),
  { message: 'SMART_ACCOUNT_PENDING_STATE' },
  'SMART_ACCOUNT_PENDING_STATE',
])(
  'recognizes the exact pending-state diagnostic across the popup boundary: %p',
  (error) => expect(isSmartAccountPendingReviewError(error)).toBe(true)
);
it.each([
  null,
  undefined,
  new Error('Other error'),
  { code: 'SMART_ACCOUNT_PENDING_STATE' },
  { message: 'RPC error: SMART_ACCOUNT_PENDING_STATE' },
])(
  'does not mistake another error for the pending-state diagnostic: %p',
  (error) => expect(isSmartAccountPendingReviewError(error)).toBe(false)
);
it('does not read accessor properties when classifying a message', () => {
  const read = jest.fn(() => 'SMART_ACCOUNT_PENDING_STATE');
  expect(
    isSmartAccountPendingReviewError({
      get message() {
        return read();
      },
    })
  ).toBe(false);
  expect(read).not.toHaveBeenCalled();
});
