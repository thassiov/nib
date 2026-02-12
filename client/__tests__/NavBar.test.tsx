/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../contexts/AuthContext";
import { NavBar } from "../components/NavBar";

function renderNavBar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <NavBar />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("NavBar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("always shows brand and gallery link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );

    renderNavBar();
    await waitFor(() => {
      expect(screen.getByText("nib")).toBeDefined();
      expect(screen.getByText("Gallery")).toBeDefined();
    });
  });

  it("shows Log in button when not authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
    );

    renderNavBar();
    await waitFor(() => {
      expect(screen.getByText("Log in")).toBeDefined();
    });
    // My Drawings should not be visible
    expect(screen.queryByText("My Drawings")).toBeNull();
  });

  it("shows username, Log out, and My Drawings when authenticated", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", sub: "s", username: "alice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderNavBar();
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeDefined();
      expect(screen.getByText("Log out")).toBeDefined();
      expect(screen.getByText("My Drawings")).toBeDefined();
    });
    // Log in should not be visible
    expect(screen.queryByText("Log in")).toBeNull();
  });

  it("shows nothing in the right section while loading", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise(() => {}));
    renderNavBar();

    // Brand and Gallery are always visible
    expect(screen.getByText("nib")).toBeDefined();
    expect(screen.getByText("Gallery")).toBeDefined();
    // Neither Log in nor Log out should show during loading
    expect(screen.queryByText("Log in")).toBeNull();
    expect(screen.queryByText("Log out")).toBeNull();
  });
});
