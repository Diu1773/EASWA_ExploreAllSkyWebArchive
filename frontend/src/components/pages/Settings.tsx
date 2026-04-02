import { useAuthStore } from '../../stores/useAuthStore';

export function Settings() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (!user) {
    return (
      <div className="page-placeholder">
        <h2>Settings</h2>
        <p>Please sign in to access settings.</p>
        <a href="/api/auth/login" className="btn-primary">
          Sign in with Google
        </a>
      </div>
    );
  }

  return (
    <div className="page-placeholder">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>Account</h3>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-label">Name</span>
            <span className="settings-value">{user.name}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span className="settings-value">{user.email}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Account</span>
            <span className="settings-value">Google</span>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Session</h3>
        <button className="btn-danger" onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
