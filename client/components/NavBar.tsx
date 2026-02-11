import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function NavBar() {
  const { user, loading, login, logout } = useAuth();

  return (
    <nav style={styles.nav}>
      <div style={styles.left}>
        <Link to="/" style={styles.brand}>nib</Link>
        <Link to="/gallery" style={styles.link}>Gallery</Link>
        {user && <Link to="/my" style={styles.link}>My Drawings</Link>}
      </div>

      <div style={styles.right}>
        {loading ? null : user ? (
          <div style={styles.userArea}>
            <span style={styles.username}>{user.username}</span>
            <button onClick={logout} style={styles.button}>Log out</button>
          </div>
        ) : (
          <button onClick={login} style={styles.button}>Log in</button>
        )}
      </div>
    </nav>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "0 16px",
    height: 48,
    borderBottom: "1px solid #e0e0e0",
    backgroundColor: "#fff",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  right: {
    display: "flex",
    alignItems: "center",
  },
  brand: {
    fontWeight: 700,
    fontSize: 18,
    textDecoration: "none",
    color: "#1a1a1a",
  },
  link: {
    textDecoration: "none",
    color: "#555",
    fontSize: 14,
  },
  userArea: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  username: {
    fontSize: 14,
    color: "#333",
  },
  button: {
    padding: "6px 14px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
    backgroundColor: "#fff",
    cursor: "pointer",
  },
};
