/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import { ProtectedRoute } from "../components/ProtectedRoute";

function renderProtected(initialPath = "/protected") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<div data-testid="home">Home</div>} />
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <div data-testid="secret">Secret Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading while auth is pending", () => {
    // Mock a fetch that never resolves
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    renderProtected();
    expect(screen.getByText("Loading...")).toBeDefined();
  });

  it("redirects to / when not authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );

    renderProtected();
    await waitFor(() => {
      expect(screen.getByTestId("home")).toBeDefined();
    });
  });

  it("renders children when authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", sub: "s", username: "alice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderProtected();
    await waitFor(() => {
      expect(screen.getByTestId("secret")).toBeDefined();
      expect(screen.getByText("Secret Content")).toBeDefined();
    });
  });
});
