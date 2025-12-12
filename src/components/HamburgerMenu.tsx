// components/HamburgerMenu.tsx
import type { ReactNode } from 'react';

type HamburgerMenuProps = {
  children: ReactNode;
  buttonClassName?: string;
};

export function HamburgerMenu({ children, buttonClassName }: HamburgerMenuProps) {
  return (
    <div className="dropdown">
      <button
        className={buttonClassName ?? 'btn btn-outline-light btn-sm'}
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
      >
        ☰
      </button>
      <ul className="dropdown-menu dropdown-menu-end dropdown-menu-dark">
        {children}
      </ul>
    </div>
  );
}
