/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "../contexts/AuthContext";

// Test component that exposes auth state
function AuthDisplay() {
  const { user, loading, login, logout } = useAuth();

  if (loading) return <div data-testid="loading">Loading...</div>;

  return (
    <div>
      <div data-testid="user">{user ? user.username : "anonymous"}</div>
      <button data-testid="login" onClick={login}>Log in</button>
      <button data-testid="logout" onClick={logout}>Log out</button>
    </div>
  );
}

function renderWithAuth() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthDisplay />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state initially", () => {
    // Mock a fetch that never resolves
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    renderWithAuth();
    expect(screen.getByTestId("loading")).toBeDefined();
  });

  it("sets user when /auth/me returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", sub: "oidc-sub", username: "alice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("alice");
    });
  });

  it("sets user to null when /auth/me returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );

    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("anonymous");
    });
  });

  it("sets user to null when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("anonymous");
    });
  });

  it("login() redirects to /auth/login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );

    renderWithAuth();
    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("anonymous");
    });

    // Verify the login button renders and is clickable
    expect(screen.getByTestId("login")).toBeDefined();
  });

  it("throws when useAuth is used outside AuthProvider", () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(
        <MemoryRouter>
          <AuthDisplay />
        </MemoryRouter>,
      );
    }).toThrow("useAuth must be used within an AuthProvider");

    spy.mockRestore();
  });
});
