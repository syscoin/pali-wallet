import { dismissRejectedApproval } from '../../e2e/harness/dismissRejectedApproval';

describe.each(['locator.click', 'keyboard.press'])(
  'verified rejection popup dismissal with %s',
  (action) => {
    const closedTarget = new Error(
      `${action}: Target page, context or browser has been closed\nCall log:`
    );
    const setup = () => ({
      click: jest.fn().mockResolvedValue(undefined),
      isClosed: jest.fn().mockReturnValue(true),
      settle: jest.fn().mockResolvedValue({ error: { code: 4001 } }),
    });

    it('requires the exact request rejection after an ordinary OK click', async () => {
      const options = setup();
      await expect(dismissRejectedApproval(options)).resolves.toEqual({
        error: { code: 4001 },
      });
      expect(options.click).toHaveBeenCalledTimes(1);
      expect(options.settle).toHaveBeenCalledTimes(1);
    });

    it('accepts the acknowledged self-close race only with a numeric rejection and no result', async () => {
      const options = setup();
      options.click.mockRejectedValue(closedTarget);
      options.settle.mockResolvedValue({ error: { code: -32602 } });
      await expect(dismissRejectedApproval(options)).resolves.toEqual({
        error: { code: -32602 },
      });
      expect(options.click).toHaveBeenCalledTimes(1);
    });

    it('accepts a Cancel self-close only after the exact request returns user rejection', async () => {
      const options = setup();
      options.click.mockRejectedValue(closedTarget);
      await expect(dismissRejectedApproval(options)).resolves.toEqual({
        error: { code: 4001 },
      });
      expect(options.click).toHaveBeenCalledTimes(1);
      expect(options.settle).toHaveBeenCalledTimes(1);
    });

    it('does not swallow a closed-target error while the popup remains open', async () => {
      const options = setup();
      options.click.mockRejectedValue(closedTarget);
      options.isClosed.mockReturnValue(false);
      await expect(dismissRejectedApproval(options)).rejects.toBe(closedTarget);
      expect(options.settle).not.toHaveBeenCalled();
    });

    it('does not swallow another click error even if the popup is closed', async () => {
      const options = setup();
      const timeout = new Error(`${action}: Timeout 30000ms exceeded`);
      options.click.mockRejectedValue(timeout);
      await expect(dismissRejectedApproval(options)).rejects.toBe(timeout);
      expect(options.settle).not.toHaveBeenCalled();
    });

    it.each([
      { result: '0xsignature' },
      { error: { code: 4001 }, result: '0xsignature' },
      { error: { code: '4001' } },
      { error: { code: NaN } },
      {},
    ])(
      'never treats an invalid rejection as successful dismissal: %p',
      async (result) => {
        const options = setup();
        options.click.mockRejectedValue(closedTarget);
        options.settle.mockResolvedValue(result);
        await expect(dismissRejectedApproval(options)).rejects.toThrow(
          'reject without a result'
        );
      }
    );

    it('requires the original popup to be closed even when the request rejected', async () => {
      const options = setup();
      options.isClosed.mockReturnValue(false);
      await expect(dismissRejectedApproval(options)).rejects.toThrow(
        'reject without a result'
      );
    });

    it('propagates failure to settle instead of retrying the click or request', async () => {
      const options = setup();
      options.click.mockRejectedValue(closedTarget);
      const timeout = new Error('original request did not settle');
      options.settle.mockRejectedValue(timeout);
      await expect(dismissRejectedApproval(options)).rejects.toBe(timeout);
      expect(options.click).toHaveBeenCalledTimes(1);
      expect(options.settle).toHaveBeenCalledTimes(1);
    });

    it('preserves the caller requirement for user rejection rather than accepting another code as 4001', async () => {
      const options = setup();
      options.click.mockRejectedValue(closedTarget);
      options.settle.mockResolvedValue({ error: { code: -32602 } });
      const cancelAndCheck = async () => {
        const rejected = await dismissRejectedApproval(options);
        // This is the original ENS cancellation test's postcondition. The
        // general helper also serves non-cancellation rejection popups.
        expect(rejected.error?.code).toBe(4001);
      };
      await expect(cancelAndCheck()).rejects.toThrow('4001');
      expect(options.click).toHaveBeenCalledTimes(1);
      expect(options.settle).toHaveBeenCalledTimes(1);
    });
  }
);
