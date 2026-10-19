import { clickClosingPopup } from '../../e2e/harness/dismissRejectedApproval';

describe('popup-closing click acknowledgement', () => {
  it('performs an ordinary click once', async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    await expect(
      clickClosingPopup({ click, isClosed: () => false })
    ).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Target page, context or browser has been closed',
    'locator.click: Target page, context or browser has been closed\nCall log:',
    'keyboard.press: Target page, context or browser has been closed',
  ])('accepts only the closed popup acknowledgement: %s', async (message) => {
    const click = jest.fn().mockRejectedValue(new Error(message));
    await expect(
      clickClosingPopup({ click, isClosed: () => true })
    ).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each([
    'locator.click: Timeout 30000ms exceeded',
    'keyboard.press: Timeout 30000ms exceeded',
    'keyboard.press: Target page, context or browser has been closed unexpectedly',
    'keyboard.down: Target page, context or browser has been closed',
  ])(
    'preserves other action failures even when the popup is closed: %s',
    async (message) => {
      const error = new Error(message);
      await expect(
        clickClosingPopup({
          click: jest.fn().mockRejectedValue(error),
          isClosed: () => true,
        })
      ).rejects.toBe(error);
    }
  );

  it.each(['locator.click', 'keyboard.press'])(
    'refuses a closed-target acknowledgement while the popup remains open: %s',
    async (action) => {
      const error = new Error(
        `${action}: Target page, context or browser has been closed`
      );
      await expect(
        clickClosingPopup({
          click: jest.fn().mockRejectedValue(error),
          isClosed: () => false,
        })
      ).rejects.toBe(error);
    }
  );

  it('cannot bypass the ordinary-approval postcondition when the whole context closes', async () => {
    const error = new Error(
      'locator.click: Target page, context or browser has been closed'
    );
    const ordinaryApprovalVisible = jest.fn().mockRejectedValue(error);
    const continueToApproval = async () => {
      await clickClosingPopup({
        click: jest.fn().mockRejectedValue(error),
        isClosed: () => true,
      });
      await ordinaryApprovalVisible();
    };
    await expect(continueToApproval()).rejects.toBe(error);
    expect(ordinaryApprovalVisible).toHaveBeenCalledTimes(1);
  });
});
