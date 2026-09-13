import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export function Button({ variant = 'secondary', children, ...rest }: Props) {
  return (
    <button type="button" data-variant={variant} className={`btn btn--${variant}`} {...rest}>
      {children}
    </button>
  );
}
