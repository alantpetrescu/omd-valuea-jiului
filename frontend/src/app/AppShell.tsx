/**
 * Application shell — sidebar, topbar, content area.
 *
 * Markup and class names are the prototype's, so the lifted stylesheet applies
 * unchanged. Spec 11.7: one shell for every role; the role decides which items
 * appear, and ADMIN sees the extra Administrare section in the same sidebar
 * rather than a separate backoffice.
 */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { ROLE_LABELS, useAuth } from '../features/auth/AuthContext';

interface NavItem {
  to: string;
  icon: string;
  label: string;
}

const OPERATIONAL_NAV: NavItem[] = [
  { to: '/strategic', icon: '⌘', label: 'Repere strategice' },
  { to: '/campaigns', icon: '◫', label: 'Campanii' },
  { to: '/activations', icon: '▶', label: 'Activări' },
  { to: '/annual', icon: '▣', label: 'Plan anual' },
  { to: '/monitoring-activations', icon: '◌', label: 'Monitorizare activări' },
  { to: '/monitoring-reputation', icon: '◎', label: 'Monitorizare reputație' },
  { to: '/about', icon: '?', label: 'Despre aplicație' },
];

const ADMIN_NAV: NavItem[] = [{ to: '/admin', icon: '⚙', label: 'Administrare' }];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'OMD';
}

/**
 * `locked` is set while the account still carries a temporary password. The
 * navigation is then rendered as inert text rather than links: those routes are
 * refused anyway, and a link that changes the URL without changing the page
 * reads as a broken application (spec 11.5).
 */
export function AppShell({ children, locked = false }: { children: ReactNode; locked?: boolean }) {
  const { user, logout } = useAuth();
  const items = user?.role === 'ADMIN' ? [...OPERATIONAL_NAV, ...ADMIN_NAV] : OPERATIONAL_NAV;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <b>VJ</b>
          <span>
            <strong>OMD Valea Jiului</strong>
          </span>
        </div>

        <nav>
          {items.map((item) =>
            locked ? (
              <span
                key={item.to}
                className="nav locked"
                aria-disabled="true"
                title="Disponibil după schimbarea parolei"
              >
                <i>{item.icon}</i>
                <span>{item.label}</span>
              </span>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav active' : 'nav')}
              >
                <i>{item.icon}</i>
                <span>{item.label}</span>
              </NavLink>
            ),
          )}
        </nav>

        <div className="side-note">
          {locked ? (
            <>
              Meniul se deblochează după
              <br />
              schimbarea parolei temporare
            </>
          ) : (
            <>
              Campanii + activări + repere strategice
              <br />
              Date live din MySQL
            </>
          )}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <span className="topbar-title">Sistem digital de marketing</span>
          <div className="topbar-actions">
            <div className="user">
              <b>{user ? initials(user.name) : 'OMD'}</b>
              <span>{user ? ROLE_LABELS[user.role] : ''}</span>
            </div>
            {locked ? null : (
              <Link className="btn secondary" to="/change-password">
                Schimbă parola
              </Link>
            )}
            <button className="btn secondary" type="button" onClick={() => void logout()}>
              Deconectare
            </button>
          </div>
        </header>

        <div className="content">{children}</div>
      </main>
    </div>
  );
}
