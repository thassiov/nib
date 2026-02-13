import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { logger } from "../api/logger.js";

export interface User {
  id: string;
  sub: string;
  username: string;
  role: "admin" | "user";
}

interface AuthContextValue {
  /** Current user, or null if not authenticated */
  user: User | null;
  /** True while the initial /auth/me check is in flight */
  loading: boolean;
  /** Redirect to OIDC login */
  login: () => void;
  /** Redirect to OIDC logout */
  logout: () => void;
  /** Re-fetch the current user (e.g. after callback redirect) */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        logger.info("Auth: user authenticated", { username: data.username });
      } else {
        setUser(null);
        logger.info("Auth: not authenticated");
      }
    } catch (err) {
      setUser(null);
      logger.error("Auth: failed to fetch user", { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(() => {
    window.location.href = "/auth/login";
  }, []);

  const logout = useCallback(() => {
    window.location.href = "/auth/logout";
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
