import type { ReactNode } from 'react';
import { Button } from './Button';

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The app's only confirmation. Destructive actions go through it; nothing calls
 * `window.confirm`.
 */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
      <h2>{title}</h2>
      <div>{body}</div>
      <div className="dialog__actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
