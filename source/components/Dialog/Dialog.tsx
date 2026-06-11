import { Dialog as HeadlessDialog } from '@headlessui/react';
import React, { ReactNode } from 'react';

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
      className={`fixed ${zIndexClassName} inset-0 overflow-y-auto ${className}`}
      open={Boolean(show)}
      onClose={handleClose}
    >
      <div
        className={`fixed z-0 -inset-0 w-full ${overlayClass} ${
          show ? 'opacity-100' : 'opacity-0'
        } transition-opacity duration-200 ease-in-out`}
      />

      {presentation === 'center' ? (
        <div className="px-4 min-h-screen text-center">
          <HeadlessDialog.Overlay className="fixed inset-0" />

          <span
            className="inline-block align-middle h-screen"
            aria-hidden="true"
          >
            &#8203;
          </span>

          <div
            className={`transition-transform duration-200 ${
              show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            {children}
          </div>
        </div>
      ) : (
        <div className="min-h-screen text-center flex flex-col align-bottom justify-end items-center">
          <HeadlessDialog.Overlay className="fixed inset-0" />

          <div
            className={`animate-slideIn transition-transform duration-200 ${
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
  <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
    <h1 className="text-white font-medium text-base">{title}</h1>
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
  <div
    className={`rounded-t-[50px] ${
      fullWidth ? 'w-screen' : ''
    } flex flex-col align-bottom justify-end items-center bg-brand-blue400 shadow-md`}
  >
    {children}
  </div>
);

/** Title for 'center' dialogs (keeps headlessui aria wiring). */
export const CenterTitle = ({ children }: { children: ReactNode }) => (
  <HeadlessDialog.Title
    as="h3"
    className="pb-4 pt-2 text-brand-white text-lg font-medium leading-6 border-b border-dashed border-gray-600"
  >
    {children}
  </HeadlessDialog.Title>
);

/** Standard centered card panel. */
export const CenterPanel = ({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`inline-block align-middle my-8 p-6 w-full max-w-md text-center font-poppins bg-bkg-4 rounded-2xl shadow-xl overflow-hidden transform transition-all ${className}`}
  >
    {children}
  </div>
);
