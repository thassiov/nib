import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Excalidraw, MainMenu, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAuth } from "../contexts/AuthContext";
import { getScene, createScene, updateScene, patchScene } from "../api/scenes";
import type { SceneDetail } from "../api/scenes";
import { logger } from "../api/logger";
import { Badge } from "../components/ui/badge";

const AUTOSAVE_DEBOUNCE_MS = 30_000;

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

  // Track element versions at last sync for incremental diffing
  const lastSyncedVersionsRef = useRef<Map<string, number>>(new Map());
  // Ref to api for use in interval/cleanup without stale closures
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Debounce timer ref
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether we have unsaved changes (for onChange debounce trigger)
  const hasPendingChangesRef = useRef(false);

  // Keep apiRef in sync
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const canEdit = scene?.canEdit ?? false;
  const readOnly = !canEdit;

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
        // Snapshot initial element versions for incremental diffing
        const elements = (data.data?.elements || []) as Array<{ id: string; version: number }>;
        const versionMap = new Map<string, number>();
        for (const el of elements) {
          if (el.id && el.version !== undefined) versionMap.set(el.id, el.version);
        }
        lastSyncedVersionsRef.current = versionMap;
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

  // Compute the incremental diff: elements that changed or were deleted since last sync
  const getElementDiff = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) return null;

    const currentElements = currentApi.getSceneElements() as Array<{ id: string; version: number; isDeleted?: boolean; [k: string]: unknown }>;
    const lastVersions = lastSyncedVersionsRef.current;

    const upserts: unknown[] = [];
    const currentIds = new Set<string>();

    for (const el of currentElements) {
      currentIds.add(el.id);
      const lastVersion = lastVersions.get(el.id);
      if (lastVersion === undefined || el.version > lastVersion) {
        upserts.push(el);
      }
    }

    // Elements that were in the last sync but are no longer present
    const deletes: string[] = [];
    for (const id of lastVersions.keys()) {
      if (!currentIds.has(id)) {
        deletes.push(id);
      }
    }

    if (upserts.length === 0 && deletes.length === 0) return null;
    return { upserts, deletes };
  }, []);

  // Snapshot current element versions into the tracking map
  const snapshotVersions = useCallback(() => {
    const currentApi = apiRef.current;
    if (!currentApi) return;
    const elements = currentApi.getSceneElements() as Array<{ id: string; version: number }>;
    const map = new Map<string, number>();
    for (const el of elements) {
      map.set(el.id, el.version);
    }
    lastSyncedVersionsRef.current = map;
  }, []);

  // Check if elements have changed since last sync
  const isDirty = useCallback(() => {
    return getElementDiff() !== null;
  }, [getElementDiff]);

  // Generate a small PNG thumbnail as a base64 data URL
  const generateThumbnail = useCallback(async (): Promise<string | null> => {
    const currentApi = apiRef.current;
    if (!currentApi) return null;

    const elements = currentApi.getSceneElements();
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

  // Full save (manual save, unmount flush)
  const doSave = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi || readOnly || !id) return;

    const sceneData = getSceneData();
    if (!sceneData) return;

    setSaving(true);
    try {
      const thumbnail = await generateThumbnail();
      await updateScene(id, { data: sceneData, ...(thumbnail && { thumbnail }) });
      snapshotVersions();
      hasPendingChangesRef.current = false;
      setLastSaved(new Date());
      logger.info("Editor: scene saved", { id });
    } catch (err) {
      logger.error("Editor: save failed", { error: String(err) });
    } finally {
      setSaving(false);
    }
  }, [readOnly, id, getSceneData, generateThumbnail, snapshotVersions]);

  // Incremental save (autosave — only changed elements)
  const doIncrementalSave = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi || readOnly || !id) return;

    const diff = getElementDiff();
    if (!diff) return;

    setSaving(true);
    try {
      const thumbnail = await generateThumbnail();
      await patchScene(id, {
        elements: diff,
        appState: sanitizeAppState(currentApi.getAppState() as Record<string, unknown>),
        files: currentApi.getFiles() as Record<string, unknown>,
        ...(thumbnail && { thumbnail }),
      });
      snapshotVersions();
      hasPendingChangesRef.current = false;
      setLastSaved(new Date());
      logger.info("Editor: autosaved (incremental)", {
        id,
        upserts: diff.upserts.length,
        deletes: diff.deletes.length,
      });
    } catch (err) {
      // If incremental save fails, fall back to full save next time
      logger.error("Editor: incremental save failed, will retry", { error: String(err) });
    } finally {
      setSaving(false);
    }
  }, [readOnly, id, getElementDiff, generateThumbnail, sanitizeAppState, snapshotVersions]);

  // Debounced autosave: triggers 30s after the last change
  const scheduleAutosave = useCallback(() => {
    if (readOnly) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    hasPendingChangesRef.current = true;
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      doIncrementalSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [readOnly, doIncrementalSave]);

  // Clean up the debounce timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // Flush on unmount if dirty (full save for safety)
  useEffect(() => {
    const sceneId = id;
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      const currentApi = apiRef.current;
      if (currentApi && sceneId && hasPendingChangesRef.current) {
        const currentElements = currentApi.getSceneElements();
        if (currentElements.length > 0) {
          const sceneData = {
            elements: currentElements,
            appState: sanitizeAppState(currentApi.getAppState() as Record<string, unknown>),
            files: currentApi.getFiles(),
          };

          generateThumbnail()
            .then((thumbnail) => {
              updateScene(sceneId, { data: sceneData, ...(thumbnail && { thumbnail }) }).catch(() => {});
            })
            .catch(() => {
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

  // Upload New
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

    // Anonymous users trying to make private: suggest login instead
    if (!user && !newValue) {
      const shouldLogin = window.confirm(
        "To make a drawing private, you need an account. " +
        "Logging in will also save your existing drawings to your account.\n\n" +
        "Would you like to log in?"
      );
      if (shouldLogin) login();
      return;
    }

    try {
      await updateScene(id, { is_public: newValue });
      setIsPublic(newValue);
      logger.info("Editor: visibility changed", { id, is_public: newValue });
    } catch (err) {
      logger.error("Editor: visibility update failed", { error: String(err) });
    }
  }, [id, isPublic, readOnly, user, login]);

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
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <p className="text-muted-foreground">Loading drawing...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-48px)]">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border bg-secondary/50">
        <div className="flex items-center gap-2">
          {editingTitle && !readOnly ? (
            <input
              className="text-sm font-medium px-1 py-0.5 border border-input rounded-sm outline-none w-50 bg-background"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              className={`text-sm font-medium text-foreground px-1 py-0.5 rounded-sm ${readOnly ? "" : "cursor-pointer hover:bg-accent"}`}
              onClick={() => !readOnly && setEditingTitle(true)}
              title={readOnly ? undefined : "Click to rename"}
            >
              {title}
            </span>
          )}
          {readOnly && (
            <Badge variant="secondary" className="text-[11px]">View only</Badge>
          )}
          {!readOnly && (
            <Badge
              variant={isPublic ? "default" : "outline"}
              className={`text-[11px] ${isPublic ? "bg-green-100 text-green-800 hover:bg-green-100" : ""}`}
            >
              {isPublic ? "Public" : "Private"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-xs text-muted-foreground">Saving...</span>}
          {!saving && lastSaved && (
            <span className="text-xs text-muted-foreground">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Excalidraw canvas */}
      <div className="flex-1 overflow-hidden">
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
          onChange={scheduleAutosave}
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
            {!readOnly && (
              <MainMenu.Item onSelect={handleSave}>
                Save now
              </MainMenu.Item>
            )}

            {!readOnly && (
              <MainMenu.Item onSelect={handleTogglePublic}>
                {isPublic ? "Make Private" : "Make Public"}
              </MainMenu.Item>
            )}

            <MainMenu.Item onSelect={handleClone}>
              Make a Copy
            </MainMenu.Item>

            <MainMenu.Separator />

            <MainMenu.Item onSelect={handleUploadNew}>
              Upload New Drawing
            </MainMenu.Item>

            <MainMenu.DefaultItems.Export />

            <MainMenu.Separator />

            <MainMenu.ItemLink href="/gallery">
              Public Gallery
            </MainMenu.ItemLink>
            {user && (
              <MainMenu.ItemLink href="/my">
                My Drawings
              </MainMenu.ItemLink>
            )}

            <MainMenu.Separator />

            <MainMenu.DefaultItems.ToggleTheme />
            <MainMenu.DefaultItems.Help />

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
