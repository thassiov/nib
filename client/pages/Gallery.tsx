import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { listPublicScenes } from "../api/scenes";
import { SceneCard } from "../components/SceneCard";
import { NewDrawingButton } from "../components/NewDrawingButton";
import { UploadDrawingButton } from "../components/UploadDrawingButton";
import type { SceneListItem } from "../api/scenes";

export function Gallery() {
  const { user } = useAuth();
  const [scenes, setScenes] = useState<SceneListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);

    listPublicScenes(page)
      .then((data) => {
        setScenes(data.scenes);
        setTotalPages(data.pagination.pages);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load gallery");
        setLoading(false);
      });
  }, [page]);

  return (
    <div style={{ padding: 24 }}>
      <div style={styles.header}>
        <h1>Gallery</h1>
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
        <p style={styles.status}>No public drawings yet. Be the first!</p>
      )}

      {!loading && !error && scenes.length > 0 && (
        <>
          <div style={styles.grid}>
            {scenes.map((scene) => (
              <SceneCard key={scene.id} scene={scene} showAuthor />
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
