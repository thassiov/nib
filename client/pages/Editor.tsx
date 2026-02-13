import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Excalidraw, MainMenu, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAuth } from "../contexts/AuthContext";
import { getScene, createScene, updateScene } from "../api/scenes";
import type { SceneDetail } from "../api/scenes";
import { logger } from "../api/logger";

const SYNC_INTERVAL_MS = 5000;

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  // Snapshot of elements at last sync (for dirty detection)
  const lastSyncedElementsRef = useRef<readonly any[] | null>(null);
  // Ref to api for use in interval/cleanup without stale closures
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  // Keep apiRef in sync
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const isOwner = scene ? scene.user_id === user?.id : !!user;
  const readOnly = !isOwner;

  // Load scene
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getScene(id!)
      .then((data) => {
        if (cancelled) return;
        setScene(data);
        setTitle(data.title);
        setIsPublic(data.is_public);
        setLoading(false);
        logger.info("Editor: scene loaded", { id: data.id, title: data.title });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.status === 404 ? "Drawing not found" : "Failed to load drawing");
        setLoading(false);
        logger.error("Editor: failed to load scene", { id, status: err.status });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Strip runtime-only fields from appState before persisting.
  // Excalidraw keeps `collaborators` as a Map (not JSON-serializable)
  // and other transient UI state that shouldn't be saved.
  const sanitizeAppState = useCallback((appState: Record<string, unknown>) => {
    const { collaborators, ...rest } = appState;
    return rest;
  }, []);

  // Get current scene data from the Excalidraw API ref
  const getSceneData = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) return null;
    return {
      elements: currentApi.getSceneElements(),
      appState: sanitizeAppState(currentApi.getAppState() as Record<string, unknown>),
      files: currentApi.getFiles(),
    };
  }, [sanitizeAppState]);

  // Check if elements have changed since last sync
  const isDirty = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) return false;
    const currentElements = currentApi.getSceneElements();
    if (!lastSyncedElementsRef.current) return currentElements.length > 0;
    if (currentElements.length !== lastSyncedElementsRef.current.length) return true;
    // Reference check — Excalidraw creates new element objects on change
    return currentElements !== lastSyncedElementsRef.current;
  }, []);

  // Generate a small PNG thumbnail as a base64 data URL
  const generateThumbnail = useCallback(async (): Promise<string | null> => {
    const currentApi = apiRef.current;
    if (!currentApi) return null;

    const elements = currentApi.getSceneElements();
    // Skip if canvas is empty (no non-deleted elements)
    if (!elements.length || elements.every((el: any) => el.isDeleted)) return null;

    try {
      const blob = await exportToBlob({
        elements,
        appState: {
          ...currentApi.getAppState(),
          exportWithDarkMode: false,
          exportBackground: true,
        },
        files: currentApi.getFiles(),
        maxWidthOrHeight: 300,
      });

      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      logger.error("Editor: thumbnail generation failed", { error: String(err) });
      return null;
    }
  }, []);

  // Core save function
  const doSave = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi || readOnly || !id) return;

    const sceneData = getSceneData();
    if (!sceneData) return;

    setSaving(true);
    try {
      const thumbnail = await generateThumbnail();
      await updateScene(id, { data: sceneData, ...(thumbnail && { thumbnail }) });
      lastSyncedElementsRef.current = currentApi.getSceneElements();
      setLastSaved(new Date());
      logger.info("Editor: scene saved", { id });
    } catch (err) {
      logger.error("Editor: save failed", { error: String(err) });
    } finally {
      setSaving(false);
    }
  }, [readOnly, id, getSceneData, generateThumbnail]);

  // 5-second sync interval
  useEffect(() => {
    if (readOnly) return;

    const interval = setInterval(async () => {
      if (isDirty()) {
        const currentApi = apiRef.current;
        if (!currentApi) return;

        const sceneData = {
          elements: currentApi.getSceneElements(),
          appState: sanitizeAppState(currentApi.getAppState() as Record<string, unknown>),
          files: currentApi.getFiles(),
        };

        try {
          const thumbnail = await generateThumbnail();
          await updateScene(id!, { data: sceneData, ...(thumbnail && { thumbnail }) });
          lastSyncedElementsRef.current = currentApi.getSceneElements();
          setLastSaved(new Date());
          logger.info("Editor: autosaved", { id });
        } catch (err) {
          logger.error("Editor: autosave failed", { error: String(err) });
        }
      }
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [id, readOnly, isDirty, generateThumbnail, sanitizeAppState]);

  // Flush on unmount if dirty (fire-and-forget, best-effort thumbnail).
  // Guard: skip if elements are empty — Excalidraw may return [] during teardown
  // when the canvas is already destroyed.
  useEffect(() => {
    const sceneId = id;
    return () => {
      const currentApi = apiRef.current;
      if (currentApi && sceneId) {
        const currentElements = currentApi.getSceneElements();
        const lastSynced = lastSyncedElementsRef.current;
        const dirty = !lastSynced || currentElements !== lastSynced;

        if (dirty && currentElements.length > 0) {
          const sceneData = {
            elements: currentElements,
            appState: sanitizeAppState(currentApi.getAppState() as Record<string, unknown>),
            files: currentApi.getFiles(),
          };

          // Try to generate thumbnail, but don't block the save
          generateThumbnail()
            .then((thumbnail) => {
              updateScene(sceneId, { data: sceneData, ...(thumbnail && { thumbnail }) }).catch(() => {});
            })
            .catch(() => {
              // Thumbnail failed (canvas gone), save without it
              updateScene(sceneId, { data: sceneData }).catch(() => {});
            });
        }
      }
    };
  }, [id, generateThumbnail, sanitizeAppState]);

  // Manual save (flush now)
  const handleSave = useCallback(() => {
    doSave();
  }, [doSave]);

  // Clone / Make a Copy
  const handleClone = useCallback(async () => {
    const sceneData = getSceneData();
    if (!sceneData) return;

    setSaving(true);
    try {
      const cloneTitle = `Copy of ${title}`;
      const thumbnail = await generateThumbnail();
      const created = await createScene({
        title: cloneTitle,
        data: sceneData,
        is_public: false,
        ...(thumbnail && { thumbnail }),
      });
      navigate(`/drawing/${created.id}`);
      logger.info("Editor: scene cloned", { id: created.id, title: cloneTitle });
    } catch (err) {
      logger.error("Editor: clone failed", { error: String(err) });
    } finally {
      setSaving(false);
    }
  }, [getSceneData, title, navigate, generateThumbnail]);

  // Upload New — opens file picker, creates new scene from file, navigates
  const handleUploadNew = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".excalidraw,.json";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        alert("File is not valid JSON");
        return;
      }

      const uploadTitle = file.name.replace(/\.(excalidraw|json)$/i, "");

      setSaving(true);
      try {
        const created = await createScene({
          title: uploadTitle,
          data: parsed as object,
        });
        navigate(`/drawing/${created.id}`);
        logger.info("Editor: uploaded new scene", { id: created.id, title: uploadTitle });
      } catch (err: any) {
        if (err.status === 422) {
          alert("Invalid Excalidraw file: the scene data failed validation");
        } else {
          logger.error("Editor: upload failed", { error: String(err) });
          alert("Upload failed");
        }
      } finally {
        setSaving(false);
      }
    };

    input.click();
  }, [navigate]);

  // Toggle public/private
  const handleTogglePublic = useCallback(async () => {
    if (!id || readOnly) return;

    const newValue = !isPublic;
    try {
      await updateScene(id, { is_public: newValue });
      setIsPublic(newValue);
      logger.info("Editor: visibility changed", { id, is_public: newValue });
    } catch (err) {
      logger.error("Editor: visibility update failed", { error: String(err) });
    }
  }, [id, isPublic, readOnly]);

  const handleTitleSubmit = useCallback(async () => {
    setEditingTitle(false);
    if (id && !readOnly) {
      try {
        await updateScene(id, { title });
        logger.info("Editor: title updated", { id, title });
      } catch (err) {
        logger.error("Editor: title update failed", { error: String(err) });
      }
    }
  }, [id, title, readOnly]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleTitleSubmit();
      if (e.key === "Escape") setEditingTitle(false);
    },
    [handleTitleSubmit],
  );

  if (loading) {
    return (
      <div style={styles.center}>
        <p>Loading drawing...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.center}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      {/* Editor toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.titleArea}>
          {editingTitle && !readOnly ? (
            <input
              style={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              style={{ ...styles.titleText, cursor: readOnly ? "default" : "pointer" }}
              onClick={() => !readOnly && setEditingTitle(true)}
              title={readOnly ? undefined : "Click to rename"}
            >
              {title}
            </span>
          )}
          {readOnly && <span style={styles.badge}>View only</span>}
          {!readOnly && (
            <span style={{ ...styles.badge, backgroundColor: isPublic ? "#d4edda" : "#eee", color: isPublic ? "#155724" : "#888" }}>
              {isPublic ? "Public" : "Private"}
            </span>
          )}
        </div>
        <div style={styles.toolbarRight}>
          {saving && <span style={styles.saveStatus}>Saving...</span>}
          {!saving && lastSaved && (
            <span style={styles.saveStatus}>
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          
        </div>
      </div>

      {/* Excalidraw canvas */}
      <div style={styles.canvas}>
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={
            scene
              ? {
                  elements: scene.data.elements as any,
                  appState: {
                    ...(scene.data.appState as any),
                    collaborators: new Map(),
                  },
                  files: scene.data.files as any,
                  scrollToContent: true,
                }
              : {
                  elements: [],
                  appState: { viewBackgroundColor: "#ffffff" },
                }
          }
          viewModeEnabled={readOnly}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: { saveFileToDisk: true },
            },
          }}
        >
          <MainMenu>
            {/* Save — owner only */}
            {!readOnly && (
              <MainMenu.Item onSelect={handleSave}>
                Save now
              </MainMenu.Item>
            )}

            {/* Make Public / Make Private — owner only */}
            {!readOnly && (
              <MainMenu.Item onSelect={handleTogglePublic}>
                {isPublic ? "Make Private" : "Make Public"}
              </MainMenu.Item>
            )}

            {/* Clone / Make a Copy — logged in only */}
            {user && (
              <MainMenu.Item onSelect={handleClone}>
                Make a Copy
              </MainMenu.Item>
            )}

            <MainMenu.Separator />

            {/* Upload New — logged in only */}
            {user && (
              <MainMenu.Item onSelect={handleUploadNew}>
                Upload New Drawing
              </MainMenu.Item>
            )}

            {/* Export — built-in Excalidraw export */}
            <MainMenu.DefaultItems.Export />

            <MainMenu.Separator />

            {/* Navigation links */}
            <MainMenu.ItemLink href="/gallery">
              Public Gallery
            </MainMenu.ItemLink>
            {user && (
              <MainMenu.ItemLink href="/my">
                My Drawings
              </MainMenu.ItemLink>
            )}

            <MainMenu.Separator />

            {/* Theme toggle */}
            <MainMenu.DefaultItems.ToggleTheme />

            {/* Help */}
            <MainMenu.DefaultItems.Help />

            {/* Login — logged out only */}
            {!user && (
              <>
                <MainMenu.Separator />
                <MainMenu.Item onSelect={() => login()}>
                  Log in
                </MainMenu.Item>
              </>
            )}
          </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "calc(100vh - 48px)", // subtract NavBar height
    overflow: "hidden",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 12px",
    borderBottom: "1px solid #e0e0e0",
    backgroundColor: "#fafafa",
    height: 40,
    flexShrink: 0,
  },
  titleArea: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    fontSize: 14,
    fontWeight: 500,
    color: "#333",
    padding: "2px 4px",
    borderRadius: 3,
  },
  titleInput: {
    fontSize: 14,
    fontWeight: 500,
    padding: "2px 4px",
    border: "1px solid #ccc",
    borderRadius: 3,
    outline: "none",
    width: 200,
  },
  badge: {
    fontSize: 11,
    color: "#888",
    backgroundColor: "#eee",
    padding: "2px 6px",
    borderRadius: 3,
  },
  toolbarRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  saveStatus: {
    fontSize: 12,
    color: "#888",
  },
  saveButton: {
    padding: "4px 12px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
    backgroundColor: "#1a1a1a",
    color: "#fff",
    cursor: "pointer",
  },
  canvas: {
    flex: 1,
    overflow: "hidden",
  },
  center: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "calc(100vh - 48px)",
  },
};
