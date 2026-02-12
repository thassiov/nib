/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listPublicScenes,
  listMyScenes,
  getScene,
  createScene,
  updateScene,
  deleteScene,
  ApiError,
} from "../api/scenes";

describe("API client (scenes.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to create a mock Response
  function mockResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ========== apiFetch error handling ==========

  describe("error handling", () => {
    it("throws ApiError with status and message on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ error: "Not found" }, 404),
      );

      try {
        await getScene("nonexistent");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
        expect((err as ApiError).message).toBe("Not found");
      }
    });

    it("falls back to statusText when response body has no error field", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("not json", { status: 500, statusText: "Internal Server Error" }),
      );

      try {
        await getScene("bad");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
        expect((err as ApiError).message).toBe("Internal Server Error");
      }
    });

    it("returns undefined for 204 No Content", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 204 }),
      );

      const result = await deleteScene("some-id");
      expect(result).toBeUndefined();
    });
  });

  // ========== Request format ==========

  describe("request format", () => {
    it("sets credentials to include", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ scenes: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }),
      );

      await listPublicScenes();
      expect(spy).toHaveBeenCalledTimes(1);
      const [, options] = spy.mock.calls[0];
      expect(options?.credentials).toBe("include");
    });

    it("sets Content-Type to application/json", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ id: "s1", title: "Test" }),
      );

      await createScene({ title: "Test", data: { elements: [] } });
      const [, options] = spy.mock.calls[0];
      expect((options?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });
  });

  // ========== Individual API functions ==========

  describe("listPublicScenes", () => {
    it("calls GET /api/scenes with page and limit", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ scenes: [], pagination: { page: 2, limit: 10, total: 0, pages: 0 } }),
      );

      await listPublicScenes(2, 10);
      expect(spy.mock.calls[0][0]).toBe("/api/scenes?page=2&limit=10");
    });

    it("defaults to page 1 and limit 20", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ scenes: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }),
      );

      await listPublicScenes();
      expect(spy.mock.calls[0][0]).toBe("/api/scenes?page=1&limit=20");
    });
  });

  describe("listMyScenes", () => {
    it("calls GET /api/scenes/my with page and limit", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ scenes: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }),
      );

      await listMyScenes(1, 20);
      expect(spy.mock.calls[0][0]).toBe("/api/scenes/my?page=1&limit=20");
    });
  });

  describe("getScene", () => {
    it("calls GET /api/scenes/:id", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ id: "abc", title: "My Scene", data: {} }),
      );

      const result = await getScene("abc");
      expect(spy.mock.calls[0][0]).toBe("/api/scenes/abc");
      expect(result.id).toBe("abc");
    });
  });

  describe("createScene", () => {
    it("calls POST /api/scenes with JSON body", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ id: "new-1", title: "Created" }),
      );

      const data = { title: "Created", data: { elements: [{ id: "e1" }] } };
      await createScene(data);

      const [url, options] = spy.mock.calls[0];
      expect(url).toBe("/api/scenes");
      expect(options?.method).toBe("POST");
      expect(JSON.parse(options?.body as string)).toEqual(data);
    });
  });

  describe("updateScene", () => {
    it("calls PUT /api/scenes/:id with JSON body", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        mockResponse({ id: "s1", title: "Updated" }),
      );

      await updateScene("s1", { title: "Updated" });

      const [url, options] = spy.mock.calls[0];
      expect(url).toBe("/api/scenes/s1");
      expect(options?.method).toBe("PUT");
      expect(JSON.parse(options?.body as string)).toEqual({ title: "Updated" });
    });
  });

  describe("deleteScene", () => {
    it("calls DELETE /api/scenes/:id", async () => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 204 }),
      );

      await deleteScene("s1");

      const [url, options] = spy.mock.calls[0];
      expect(url).toBe("/api/scenes/s1");
      expect(options?.method).toBe("DELETE");
    });
  });
});
