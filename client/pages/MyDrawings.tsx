import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { listMyScenes, deleteScene } from "../api/scenes";
import { SceneCard } from "../components/SceneCard";
import { NewDrawingButton } from "../components/NewDrawingButton";
import { UploadDrawingButton } from "../components/UploadDrawingButton";
import type { SceneListItem } from "../api/scenes";

export function MyDrawings() {
  const { user } = useAuth();
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);

    listMyScenes(page)
      .then((data) => {
        setScenes(data.scenes);
        setTotalPages(data.pagination.pages);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load your drawings");
        setLoading(false);
      });
  }, [page]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;

    try {
      await deleteScene(id);
      setScenes((prev) => prev.filter((s) => s.id !== id));
    } catch {
      alert("Failed to delete drawing");
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={styles.header}>
        <h1>My Drawings</h1>
        <div style={styles.headerActions}>
          <UploadDrawingButton style={styles.uploadButton}>
            Upload
          </UploadDrawingButton>
          <NewDrawingButton style={styles.newButton}>
            New Drawing
          </NewDrawingButton>
        </div>
      </div>

      {loading && <p style={styles.status}>Loading...</p>}
      {error && <p style={{ ...styles.status, color: "#c00" }}>{error}</p>}

      {!loading && !error && scenes.length === 0 && (
        <div style={{ textAlign: "center", marginTop: 48 }}>
          <p style={{ color: "#666", marginBottom: 16 }}>You haven't created any drawings yet.</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            <UploadDrawingButton style={styles.uploadButton}>
              Upload a drawing
            </UploadDrawingButton>
            <NewDrawingButton style={styles.newButton}>
              Create your first drawing
            </NewDrawingButton>
          </div>
        </div>
      )}

      {!loading && !error && scenes.length > 0 && (
        <>
          <div style={styles.grid}>
            {scenes.map((scene) => (
              <div key={scene.id} style={styles.cardWrapper}>
                <SceneCard scene={scene} />
                <div style={styles.cardActions}>
                  <span style={styles.visibility}>
                    {scene.is_public ? "Public" : "Private"}
                  </span>
                  <button
                    onClick={() => handleDelete(scene.id, scene.title)}
                    style={styles.deleteButton}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={styles.pageButton}
              >
                Previous
              </button>
              <span style={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={styles.pageButton}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  headerActions: {
    display: "flex",
    gap: 8,
  },
  uploadButton: {
    padding: "8px 16px",
    backgroundColor: "#fff",
    color: "#1a1a1a",
    border: "1px solid #ccc",
    borderRadius: 4,
    fontSize: 14,
    cursor: "pointer",
  },
  newButton: {
    padding: "8px 16px",
    backgroundColor: "#1a1a1a",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 14,
    cursor: "pointer",
  },
  status: {
    color: "#666",
    textAlign: "center" as const,
    marginTop: 48,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 16,
  },
  cardWrapper: {
    display: "flex",
    flexDirection: "column",
  },
  cardActions: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 2px",
    marginTop: 4,
  },
  visibility: {
    fontSize: 12,
    color: "#888",
  },
  deleteButton: {
    fontSize: 12,
    color: "#c00",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: 24,
  },
  pageButton: {
    padding: "6px 14px",
    fontSize: 13,
    border: "1px solid #ccc",
    borderRadius: 4,
    backgroundColor: "#fff",
    cursor: "pointer",
  },
  pageInfo: {
    fontSize: 13,
    color: "#666",
  },
};
