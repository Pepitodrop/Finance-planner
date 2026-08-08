import type { ReactNode } from 'react'
import { AlertTriangle, ShieldAlert, type LucideIcon } from 'lucide-react'
import { useDialog } from './useDialog'

export type ConfirmationSeverity = 'info' | 'warning' | 'danger'

interface ConfirmationDialogProps {
  open: boolean
  severity: ConfirmationSeverity
  heading: string
  headingId: string
  icon?: LucideIcon
  children: ReactNode
  // Optional tertiary content rendered AFTER the Cancel/Confirm row (e.g. a
  // "use encrypted backup instead" link) -- kept out of `children`
  // specifically so it can never become the first focusable element in the
  // dialog and steal default focus away from Cancel. `children` itself
  // should stay non-interactive (plain body text) for the same reason.
  footer?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  role?: 'dialog' | 'alertdialog'
}

const SEVERITY_ICON: Record<ConfirmationSeverity, LucideIcon> = {
  info: ShieldAlert,
  warning: AlertTriangle,
  danger: AlertTriangle,
}

/**
 * Shared Finance-Planner-owned confirmation surface for every destructive or
 * privacy-sensitive action introduced in Step 13 (CSV plaintext export,
 * reset financial data, the final account-deletion step, disconnecting a
 * provider) -- replaces window.confirm() everywhere it's used. Reuses the
 * app's existing useDialog (inert background/focus trap/Escape/restore
 * focus, same as VaultConflict) and the existing .modal/.modal-backdrop
 * chrome rather than inventing a second dialog implementation.
 *
 * Deliberately stays generic: no typed-confirmation-phrase support lives
 * here, since the one flow that needs a typed phrase (account deletion)
 * gates that on its own full page before this dialog ever opens -- this
 * component only ever asks a single yes/no question. Default focus lands
 * on Cancel, never on the destructive action, for every severity -- this
 * only holds as long as `children` stays non-interactive; anything
 * clickable belongs in `footer` instead (see its doc comment above).
 */
export function ConfirmationDialog({
  open,
  severity,
  heading,
  headingId,
  icon,
  children,
  footer,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  role = 'dialog',
}: ConfirmationDialogProps) {
  const dialogRef = useDialog<HTMLDivElement>({ open, onClose })
  if (!open) return null

  const Icon = icon ?? SEVERITY_ICON[severity]

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div
      ref={dialogRef}
      className={`modal confirmation-dialog confirmation-dialog--${severity}`}
      role={role}
      aria-modal="true"
      aria-labelledby={headingId}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="confirmation-dialog__icon" aria-hidden="true"><Icon size={22}/></div>
      <h2 id={headingId}>{heading}</h2>
      <div className="confirmation-dialog__body">{children}</div>
      <div className="modal-actions">
        {/* No explicit autoFocus: useDialog already focuses the first
            focusable element on open, and Cancel is first in DOM order for
            every severity here, so this never lands on the destructive
            action by default. */}
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</button>
        <button
          type="button"
          className={severity === 'danger' ? 'danger-action' : severity === 'warning' ? 'confirmation-dialog__confirm confirmation-dialog__confirm--warning' : 'primary'}
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
      {footer && <div className="confirmation-dialog__footer">{footer}</div>}
    </div>
  </div>
}
