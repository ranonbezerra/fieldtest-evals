import { useId, useState, type ReactNode } from 'react';

/**
 * The app's only tooltip. Anything that needs one reuses this — including
 * disabled controls, which is why the trigger is wrapped rather than cloned:
 * a disabled button fires no pointer events of its own.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span role="tooltip" id={id} className="tooltip__bubble">
          {label}
        </span>
      )}
    </span>
  );
}
