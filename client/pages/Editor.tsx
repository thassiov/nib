import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useAuth } from "../contexts/AuthContext";
import { getScene, createScene, updateScene } from "../api/scenes";
import type { SceneDetail } from "../api/scenes";

const AUTOSAVE_DELAY_MS = 3000;

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [scene, setScene] = useState<SceneDetail | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);

  // Track the scene ID for new drawings that get saved for the first time
  const sceneIdRef = useRef<string | null>(id || null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasChangesRef = useRef(false);

  const isOwner = scene ? scene.user_id === user?.id : !!user;
  const isNew = !id;
  const readOnly = !isNew && !isOwner;

  // Load existing scene
  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getScene(id)
      .then((data) => {
        if (cancelled) return;
        setScene(data);
        setTitle(data.title);
        sceneIdRef.current = data.id;
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.status === 404 ? "Drawing not found" : "Failed to load drawing");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Flush pending autosave on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        // Fire a synchronous save attempt on unmount if there are changes
        if (hasChangesRef.current && api && sceneIdRef.current) {
          const elements = api.getSceneElements();
          const appState = api.getAppState();
          const files = api.getFiles();
          // Best-effort fire-and-forget save
          updateScene(sceneIdRef.current, {
            data: { elements, appState, files },
          }).catch(() => {});
        }
      }
    };
  }, [api]);

  const doSave = useCallback(async () => {
    if (!api || readOnly) return;

    const elements = api.getSceneElements();
    const appState = api.getAppState();
    const files = api.getFiles();
    const sceneData = { elements, appState, files };

    setSaving(true);
    try {
      if (sceneIdRef.current) {
        // Update existing
        await updateScene(sceneIdRef.current, { data: sceneData });
      } else {
        // Create new
        const created = await createScene({ title, data: sceneData });
        sceneIdRef.current = created.id;
        setScene(created);
        // Update URL without remounting
        navigate(`/drawing/${created.id}`, { replace: true });
      }
      hasChangesRef.current = false;
      setLastSaved(new Date());
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [api, readOnly, title, navigate]);

  const handleChange = useCallback(() => {
    if (readOnly) return;

    hasChangesRef.current = true;

    // Debounced autosave for existing scenes
    if (sceneIdRef.current) {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        doSave();
      }, AUTOSAVE_DELAY_MS);
    }
  }, [readOnly, doSave]);

  const handleTitleSubmit = useCallback(async () => {
    setEditingTitle(false);
    if (sceneIdRef.current && !readOnly) {
      try {
        await updateScene(sceneIdRef.current, { title });
      } catch (err) {
        console.error("Title update failed:", err);
      }
    }
  }, [title, readOnly]);

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
        </div>
        <div style={styles.toolbarRight}>
          {saving && <span style={styles.saveStatus}>Saving...</span>}
          {!saving && lastSaved && (
            <span style={styles.saveStatus}>
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {!readOnly && !sceneIdRef.current && (
            <button onClick={doSave} style={styles.saveButton}>
              Save
            </button>
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
                  appState: scene.data.appState as any,
                  files: scene.data.files as any,
                  scrollToContent: true,
                }
              : {
                  elements: [],
                  appState: { viewBackgroundColor: "#ffffff" },
                }
          }
          onChange={handleChange}
          viewModeEnabled={readOnly}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              export: false,
            },
          }}
        />
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
