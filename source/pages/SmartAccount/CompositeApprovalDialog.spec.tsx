/** @jest-environment jsdom */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { SmartAccountValidatorModule } from 'types/network';

import CompositeApprovalDialog, {
  ICompositeApprovalValue,
} from './CompositeApprovalDialog';

// Keep the real dialog, Headless UI focus trap, form controls and shared Button.
// Address display is unrelated to policy selection and normally loads wallet
// clipboard hooks; the only icon mock is Button's unrelated loading glyph.
jest.mock('components/AddressText', () => ({
  AddressText: ({ value }: { value: string }) => <span>{value}</span>,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], messages);
      return typeof message === 'string'
        ? message.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name]))
        : key;
    },
  }),
}));

const address = (value: number) => `0x${value.toString(16).padStart(40, '0')}`;
const candidates = [
  { id: 'ecdsa', address: address(1), type: 'validator', config: {} },
  { id: 'p256-webauthn', address: address(2), type: 'validator', config: {} },
  { id: 'slh-dsa', address: address(3), type: 'validator', config: {} },
] as SmartAccountValidatorModule[];

// JSDOM does not perform layout. Preserve the real Dialog while providing the
// observer API it uses only to notice a dialog being resized to zero pixels.
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

const mount = (
  initial: ICompositeApprovalValue = {
    children: [address(1), address(2)],
    threshold: 1,
  },
  options: { candidates?: SmartAccountValidatorModule[]; saving?: boolean } = {}
) => {
  const onChange = jest.fn();
  const onClose = jest.fn();
  const onSave = jest.fn();
  const Harness = () => {
    const [value, setValue] = React.useState(initial);
    return (
      <CompositeApprovalDialog
        candidates={options.candidates || candidates}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        onClose={onClose}
        onSave={onSave}
        saving={options.saving || false}
        value={value}
      />
    );
  };
  const view = render(<Harness />);
  return { ...view, onChange, onClose, onSave };
};
const saveButton = () =>
  screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement;
const threshold = () =>
  screen.getByRole('combobox', {
    name: 'Approvals required',
  }) as HTMLSelectElement;

it.each([
  { children: [], threshold: 1 },
  { children: [address(1)], threshold: 0 },
  { children: [address(1)], threshold: -1 },
  { children: [address(1), address(2)], threshold: 1.5 },
  { children: [address(1)], threshold: 2 },
  { children: [address(1)], threshold: NaN },
  { children: [address(1)], threshold: Infinity },
  { children: [address(1), address(1)], threshold: 1 },
  { children: [address(1), address(99)], threshold: 1 },
])(
  'disables Save and rejects direct form submission for invalid policy %j',
  (value) => {
    const { onSave } = mount(value);
    const button = saveButton();
    expect(button.disabled).toBe(true);
    fireEvent.submit(button.closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
  }
);

it('offers only integer thresholds and explains any-one, intermediate and all-required policies', async () => {
  const user = userEvent.setup();
  const { onSave } = mount({
    children: candidates.map((candidate) => candidate.address),
    threshold: 1,
  });
  expect(
    screen.getByText('Any one selected method can approve on its own.')
  ).toBeTruthy();
  expect(
    within(threshold())
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
  ).toEqual(['1', '2', '3']);
  expect(screen.queryByRole('spinbutton')).toBeNull();
  await user.selectOptions(threshold(), '2');
  expect(
    screen.getByText('2 of 3 selected methods must approve.')
  ).toBeTruthy();
  await user.selectOptions(threshold(), '3');
  expect(screen.getByText('All 3 selected methods must approve.')).toBeTruthy();
  expect(saveButton().disabled).toBe(false);
  expect(onSave).not.toHaveBeenCalled();
  await user.tab();
  await user.tab();
  expect(document.activeElement).toBe(saveButton());
  await user.keyboard('{Enter}');
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('clamps the threshold when deselecting and preserves it when adding a method', async () => {
  const user = userEvent.setup();
  const { onChange } = mount({
    children: candidates.map((candidate) => candidate.address),
    threshold: 3,
  });
  const boxes = screen.getAllByRole('checkbox');
  await user.click(boxes[2]);
  expect(onChange).toHaveBeenLastCalledWith({
    children: [address(1), address(2)],
    threshold: 2,
  });
  expect(threshold().value).toBe('2');
  await user.click(boxes[2]);
  expect(onChange).toHaveBeenLastCalledWith({
    children: [address(1), address(2), address(3)],
    threshold: 2,
  });
  for (const box of screen.getAllByRole('checkbox')) await user.click(box);
  expect(onChange).toHaveBeenLastCalledWith({ children: [], threshold: 1 });
  expect(threshold().disabled).toBe(true);
  expect(saveButton().disabled).toBe(true);
  await user.click(screen.getAllByRole('checkbox')[0]);
  expect(threshold().value).toBe('1');
  expect(saveButton().disabled).toBe(false);
});

it('describes a single selected method without implying multiple approvals', () => {
  mount({ children: [address(1)], threshold: 1 });
  expect(screen.getByText('The selected method must approve.')).toBeTruthy();
  expect(saveButton().disabled).toBe(false);
});

it('requires enough locally signable children rather than counting an optional custom validator', async () => {
  const user = userEvent.setup();
  const custom = {
    id: 'custom',
    type: 'validator',
    address: address(4),
    config: { name: 'External validator' },
  } as SmartAccountValidatorModule;
  mount(
    { children: [address(1), address(4)], threshold: 2 },
    { candidates: [candidates[0], custom] }
  );
  expect(saveButton().disabled).toBe(true);
  expect(
    screen.getByText(/must keep enough Pali-signable validators/)
  ).toBeTruthy();
  await user.selectOptions(threshold(), '1');
  expect(saveButton().disabled).toBe(false);
});

it('exposes title, descriptions, keyboard focus and trapped Tab navigation with the real Dialog', async () => {
  const user = userEvent.setup();
  mount();
  const dialog = screen.getByRole('dialog', { name: 'Combined approvals' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  const description = document.getElementById(
    dialog.getAttribute('aria-describedby')!
  );
  expect(description?.textContent).toBeTruthy();
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes).toHaveLength(3);
  expect(screen.getByRole('checkbox', { name: 'Pali wallet' })).toBe(boxes[0]);
  expect(screen.getByRole('checkbox', { name: 'Passkey' })).toBe(boxes[1]);
  expect(screen.getByRole('checkbox', { name: 'Post-quantum SLH-DSA' })).toBe(
    boxes[2]
  );
  for (const box of boxes) {
    const name = document.getElementById(box.getAttribute('aria-labelledby')!);
    const details = document.getElementById(
      box.getAttribute('aria-describedby')!
    );
    expect(name?.textContent).toBeTruthy();
    expect(details?.textContent).toBeTruthy();
  }
  await waitFor(() =>
    expect(dialog.contains(document.activeElement)).toBe(true)
  );
  const panel = dialog.querySelector('[tabindex="-1"]')!;
  expect(document.activeElement).toBe(panel);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Close' })
  );
  await user.tab();
  expect(document.activeElement).toBe(boxes[0]);
  await user.keyboard(' ');
  expect((boxes[0] as HTMLInputElement).checked).toBe(false);
  expect(boxes[0].closest('label')?.className).toContain('focus-within:ring-2');
  threshold().focus();
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Cancel' })
  );
  await user.tab();
  expect(document.activeElement).toBe(saveButton());
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Close' })
  );
});

it('allows Escape, Cancel and Close while idle', async () => {
  const user = userEvent.setup();
  const { onClose } = mount();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(3);
});

it('blocks closing, edits and form submission while saving', async () => {
  const user = userEvent.setup();
  const warn = jest.spyOn(console, 'warn');
  const { onClose, onSave, onChange } = mount(undefined, { saving: true });
  const dialog = screen.getByRole('dialog');
  const panel = dialog.querySelector('[tabindex="-1"]')!;
  await waitFor(() => expect(document.activeElement).toBe(panel));
  expect(panel.getAttribute('aria-busy')).toBe('true');
  for (const box of screen.getAllByRole('checkbox')) {
    expect(box.matches(':disabled')).toBe(true);
    await user.click(box);
    fireEvent.change(box, { target: { checked: false } });
  }
  expect(threshold().disabled).toBe(true);
  fireEvent.change(threshold(), { target: { value: '2' } });
  expect(
    (screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  const saving = screen.getByRole('button', {
    name: 'Saving policy…',
  }) as HTMLButtonElement;
  expect(saving.disabled).toBe(true);
  fireEvent.submit(saving.closest('form')!);
  await user.keyboard('{Escape}');
  await user.click(dialog);
  expect(onClose).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalledWith(
    'There are no focusable elements inside the <FocusTrap />'
  );
  warn.mockRestore();
});
