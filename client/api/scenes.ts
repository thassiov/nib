/**
 * API client for scene CRUD operations.
 */

export interface SceneListItem {
  id: string;
  title: string;
  thumbnail: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
}

export interface SceneDetail {
  id: string;
  user_id: string;
  title: string;
  data: {
    elements: unknown[];
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  thumbnail: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
}

export interface PaginatedResponse<T> {
  scenes: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** List public scenes (gallery) */
export async function listPublicScenes(page = 1, limit = 20): Promise<PaginatedResponse<SceneListItem>> {
  return apiFetch(`/api/scenes?page=${page}&limit=${limit}`);
}

/** List current user's scenes */
export async function listMyScenes(page = 1, limit = 20): Promise<PaginatedResponse<SceneListItem>> {
  return apiFetch(`/api/scenes/my?page=${page}&limit=${limit}`);
}

/** Get a single scene by ID */
export async function getScene(id: string): Promise<SceneDetail> {
  return apiFetch(`/api/scenes/${id}`);
}

/** Create a new scene */
export async function createScene(data: {
  title?: string;
  data: object;
  is_public?: boolean;
}): Promise<SceneDetail> {
  return apiFetch("/api/scenes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Update an existing scene */
export async function updateScene(
  id: string,
  data: {
    title?: string;
    data?: object;
    is_public?: boolean;
    thumbnail?: string;
  },
): Promise<SceneDetail> {
  return apiFetch(`/api/scenes/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

/** Delete a scene */
export async function deleteScene(id: string): Promise<void> {
  return apiFetch(`/api/scenes/${id}`, { method: "DELETE" });
}
