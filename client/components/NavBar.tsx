import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { logger } from "../api/logger";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export function NavBar() {
  const { user, loading, login, logout } = useAuth();
  const [logsEnabled, setLogsEnabled] = useState(logger.isEnabled());

  useEffect(() => {
    return logger.onToggle(setLogsEnabled);
  }, []);

  const toggleLogs = () => {
    logger.setEnabled(!logsEnabled);
  };

  return (
    <nav className="flex items-center justify-between px-4 h-12 border-b border-border bg-background">
      <div className="flex items-center gap-4">
        <Link to="/" className="font-bold text-lg text-foreground no-underline">
          nib
        </Link>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/gallery" className="text-muted-foreground hover:text-foreground no-underline">
            Gallery
          </Link>
        </Button>
        {user && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/my" className="text-muted-foreground hover:text-foreground no-underline">
              My Drawings
            </Link>
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {user?.role === "admin" && (
          <button
            onClick={toggleLogs}
            className="px-2 py-1 text-xs font-mono border border-border rounded-md bg-secondary cursor-pointer transition-colors"
            style={{ color: logsEnabled ? "#2e7d32" : undefined }}
            title={logsEnabled ? "Remote logging: ON" : "Remote logging: OFF"}
          >
            {logsEnabled ? "Logs ON" : "Logs OFF"}
          </button>
        )}
        {loading ? null : user ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user.username}</span>
            <Button variant="outline" size="sm" onClick={logout}>
              Log out
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={login}>
            Log in
          </Button>
        )}
      </div>
    </nav>
  );
}
