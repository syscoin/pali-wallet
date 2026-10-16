import { Dialog as HeadlessDialog } from '@headlessui/react';
import { InformationCircleIcon, XIcon } from '@heroicons/react/outline';
import React, {
  forwardRef,
  ReactNode,
  RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button, IButtonProps } from 'components/Button';

// ---------------------------------------------------------------------------
// Dialog primitive
//
// The single modal shell for the app. Two presentations:
//   - 'center': classic centered card over a dark overlay
//   - 'sheet':  bottom sheet (rounded top), used by success/warning flows
//
// Built on HeadlessUI Dialog so every modal gets focus trapping, Escape to
// close and aria wiring for free. Variant components (DefaultModal,
// ConfirmationModal, the bottom sheets, StatusModal, ...) are declarative
// compositions over this primitive -- never hand-roll another overlay.
//
// Z-Index hierarchy (see also PageLoadingOverlay/LoadingComponent):
//   - Fixed buttons/containers: z-50
//   - PageLoadingOverlay: z-50 (overlay), z-[55] (spinner)
//   - LoadingComponent / status toasts: z-[60]
//   - Header/Navigation: z-[60]
//   - Warning/Error modals: z-[100]+ (highest priority)
// ---------------------------------------------------------------------------

export type DialogPresentation = 'center' | 'sheet';

export interface IDialogPrimitiveProps {
  children: ReactNode;
  /** Extra classes on the root (e.g. legacy callers passing positioning). */
  className?: string;
  initialFocus?: RefObject<HTMLElement>;
  onClose?: (value?: any) => any;
  /** 'transparent' keeps the page visible (status toasts). */
  overlay?: 'dark' | 'transparent';
  presentation?: DialogPresentation;
  show?: boolean;
  /** Tailwind z-class for the root; defaults to the modal layer. */
  zIndexClassName?: string;
}

export const DialogPrimitive = ({
  children,
  className = '',
  initialFocus,
  onClose,
  overlay = 'dark',
  presentation = 'center',
  show = true,
  zIndexClassName = 'z-[100]',
}: IDialogPrimitiveProps) => {
  const handleClose = () => {
    if (onClose) onClose();
  };

  const overlayClass =
    overlay === 'dark'
      ? 'bg-brand-black bg-opacity-50'
      : 'bg-transparent bg-opacity-50';

  return (
    <HeadlessDialog
      as="div"
      className={`fixed ${zIndexClassName} inset-0 overflow-y-auto font-poppins text-content-primary ${className}`}
      open={Boolean(show)}
      onClose={handleClose}
      initialFocus={initialFocus}
    >
      <div
        className={`fixed z-0 -inset-0 w-full ${overlayClass} ${
          show ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-200 ease-in-out`}
      />

      {presentation === 'center' ? (
        <div className="flex min-h-screen items-center justify-center px-4 py-4 text-center">
          <HeadlessDialog.Overlay className="fixed inset-0" />

          <div
            className={`relative flex w-full justify-center transition-transform duration-200 motion-reduce:transition-none ${
              show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen flex-col items-center justify-end px-4 py-4 text-center">
          <HeadlessDialog.Overlay className="fixed inset-0" />

          <div
            className={`relative flex w-full justify-center animate-slideIn transition-transform duration-200 motion-reduce:transition-none ${
              show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            {children}
          </div>
        </div>
      )}
    </HeadlessDialog>
  );
};

// --- Declarative building blocks -------------------------------------------

/** Header band for 'sheet' dialogs (the colored top strip). */
export const SheetHeader = ({ title }: { title: string }) => (
  <div className="w-full border-b border-alpha-whiteAlpha300 px-5 py-4">
    <HeadlessDialog.Title
      as="h2"
      className="text-lg font-medium leading-6 text-content-primary"
    >
      {title}
    </HeadlessDialog.Title>
  </div>
);

/** Standard sheet panel wrapper (rounded top, brand background). */
export const SheetPanel = ({
  children,
  fullWidth = true,
}: {
  children: ReactNode;
  fullWidth?: boolean;
}) => (
  <HeadlessDialog.Panel
    className={`relative max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-alpha-whiteAlpha300 bg-surface-raised text-content-primary shadow-xl ${
      fullWidth ? 'w-full' : 'w-[min(28rem,100%)]'
    } flex flex-col items-center`}
  >
    {children}
  </HeadlessDialog.Panel>
);

/** Title for 'center' dialogs (keeps headlessui aria wiring). */
export const CenterTitle = ({ children }: { children: ReactNode }) => (
  <HeadlessDialog.Title
    as="h2"
    className="mb-4 border-b border-alpha-whiteAlpha300 pb-4 text-lg font-medium leading-6 text-content-primary"
  >
    {children}
  </HeadlessDialog.Title>
);

/** Standard centered card panel. */
interface ICenterPanelProps {
  'aria-busy'?: boolean;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
  padded?: boolean;
  scroll?: boolean;
  tabIndex?: number;
}

export const CenterPanel = forwardRef<HTMLDivElement, ICenterPanelProps>(
  (
    { children, className = '', padded = true, scroll = true, ...props },
    ref
  ) => (
    <HeadlessDialog.Panel
      {...props}
      ref={ref}
      className={`relative w-full max-w-md max-h-[calc(100dvh-2rem)] rounded-3xl border border-alpha-whiteAlpha300 bg-surface-raised font-poppins text-center text-content-primary shadow-xl ${
        padded ? 'p-5' : ''
      } ${
        scroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'
      } ${className}`}
    >
      {children}
    </HeadlessDialog.Panel>
  )
);
CenterPanel.displayName = 'CenterPanel';

export const DialogActions = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`flex w-full flex-wrap items-stretch justify-center gap-3 [&>button]:min-w-0 [&>button]:flex-1 ${className}`}
  >
    {children}
  </div>
);

interface IDialogActionButtonProps extends Omit<IButtonProps, 'variant'> {
  tone?: 'primary' | 'secondary' | 'danger';
}

export const DialogActionButton = forwardRef<
  HTMLButtonElement,
  IDialogActionButtonProps
>(({ tone = 'primary', className = '', ...props }, ref) => (
  <Button
    {...props}
    ref={ref}
    variant={
      tone === 'secondary' ? 'ghost' : tone === 'danger' ? 'danger' : 'primary'
    }
    className={`!h-auto min-h-[44px] px-4 py-3 !text-sm hover:!scale-100 active:!scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary motion-reduce:transition-none ${
      tone === 'primary'
        ? '!text-surface-base hover:!bg-accent-primary [&_svg]:!text-surface-base'
        : tone === 'danger'
        ? '!border-[#a62218] !bg-[#a62218] !text-white hover:!bg-[#8c1d14]'
        : '!border-accent-primary !text-content-primary hover:!bg-surface-overlay'
    } ${className}`}
  />
));
DialogActionButton.displayName = 'DialogActionButton';

export const DialogCloseButton = ({
  onClick,
  disabled = false,
  className = '',
}: {
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t('buttons.close')}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface-overlay hover:text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-primary disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${className}`}
    >
      <XIcon aria-hidden="true" className="h-5 w-5" />
    </button>
  );
};

export const DialogHeader = ({
  title,
  icon,
  onClose,
  disabled = false,
  className = '',
}: {
  className?: string;
  disabled?: boolean;
  icon?: ReactNode;
  onClose?: () => void;
  title: ReactNode;
}) => (
  <header
    className={`flex shrink-0 items-center gap-3 border-b border-alpha-whiteAlpha300 px-5 py-4 text-left ${className}`}
  >
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-overlay text-content-primary [&>svg]:h-6 [&>svg]:w-6"
    >
      {icon || <InformationCircleIcon />}
    </span>
    <HeadlessDialog.Title
      as="h2"
      className="min-w-0 flex-1 break-words text-lg font-medium leading-6 text-content-primary"
    >
      {title}
    </HeadlessDialog.Title>
    {onClose && <DialogCloseButton onClick={onClose} disabled={disabled} />}
  </header>
);

export const DialogBody = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = () =>
      setScrollable(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div
      ref={bodyRef}
      tabIndex={scrollable ? 0 : undefined}
      className={`min-h-0 overflow-y-auto overscroll-contain px-5 py-5 text-left text-sm leading-relaxed text-content-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-primary ${className}`}
    >
      {children}
    </div>
  );
};

export const DialogFooter = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <footer
    className={`shrink-0 space-y-4 border-t border-alpha-whiteAlpha300 px-5 py-4 ${className}`}
  >
    {children}
  </footer>
);
