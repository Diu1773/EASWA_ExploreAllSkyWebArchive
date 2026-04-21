import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/useAuthStore';
import { buildExplorerHref } from '../../utils/explorerNavigation';

function LogoIcon() {
  return (
    <svg
      className="navbar-logo"
      width="28"
      height="28"
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="44" stroke="#ff6600" strokeWidth="3" opacity="0.9" />
      <ellipse cx="50" cy="50" rx="44" ry="16" stroke="#ff8533" strokeWidth="1.5" opacity="0.5" />
      <ellipse cx="50" cy="50" rx="16" ry="44" stroke="#ff8533" strokeWidth="1.5" opacity="0.3" />
      <circle cx="50" cy="50" r="4" fill="#ff6600" />
      <circle cx="50" cy="50" r="8" fill="#ff6600" opacity="0.2" />
      <circle cx="30" cy="35" r="2.5" fill="#ffa366" />
      <circle cx="72" cy="42" r="2.5" fill="#ffa366" />
      <circle cx="58" cy="70" r="2.5" fill="#ffa366" />
      <circle cx="38" cy="60" r="2" fill="#ffa366" opacity="0.6" />
    </svg>
  );
}

export function Navbar() {
  const location = useLocation();
  const moduleParam = new URLSearchParams(location.search).get('module');
  const isKmtnetContext =
    location.pathname.startsWith('/kmtnet') ||
    moduleParam === 'kmtnet';
  const isExplorerContext =
    (location.pathname === '/explorer' ||
      location.pathname.startsWith('/target') ||
      location.pathname.startsWith('/lab')) &&
    !isKmtnetContext;
  const defaultExplorerHref = buildExplorerHref({
    moduleId: 'tess',
    topicId: 'exoplanet_transit',
    siteId: null,
  });
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const logout = useAuthStore((s) => s.logout);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand">
        <LogoIcon />
        <div className="navbar-brand-copy">
          <span className="navbar-title">EASWA</span>
          <span className="navbar-subtitle">Exploring All-Sky Web Application</span>
        </div>
      </Link>
      <div className="navbar-links">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
          Home
        </Link>
        <Link
          to={defaultExplorerHref}
          className={isExplorerContext ? 'active' : ''}
        >
          Explorer
        </Link>
        <Link
          to="/tess"
          className={location.pathname.startsWith('/tess') ? 'active' : ''}
        >
          TESS
        </Link>
        <Link
          to="/kmtnet"
          className={isKmtnetContext ? 'active' : ''}
        >
          KMTNet
        </Link>
      </div>
      <div className="navbar-auth" ref={menuRef}>
        {loading ? null : user ? (
          <>
            <button
              className="navbar-avatar-button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="사용자 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {user.picture ? (
                <img
                  src={user.picture}
                  alt=""
                  className="navbar-avatar"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="navbar-avatar-fallback">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
            </button>

            {menuOpen && (
              <div className="user-menu">
                <div className="user-menu-header">
                  {user.picture && (
                    <img
                      src={user.picture}
                      alt=""
                      className="user-menu-avatar"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="user-menu-info">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                </div>
                <div className="user-menu-divider" />
                <Link to="/my" className={`user-menu-item${location.pathname === '/my' ? ' active' : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  My Analyses
                </Link>
                <Link to="/settings" className={`user-menu-item${location.pathname === '/settings' ? ' active' : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </Link>
                <div className="user-menu-divider" />
                <button className="user-menu-item danger" onClick={logout}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </>
        ) : (
          <a href="/api/auth/login" className="btn-sm navbar-login">
            Sign in with Google
          </a>
        )}
      </div>
    </nav>
  );
}
