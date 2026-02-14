import { useState, useEffect } from "react";
import { listPublicScenes } from "../api/scenes";
import { SceneCard } from "../components/SceneCard";
import { NewDrawingButton } from "../components/NewDrawingButton";
import { UploadDrawingButton } from "../components/UploadDrawingButton";
import { Button } from "../components/ui/button";
import type { SceneListItem } from "../api/scenes";

export function Gallery() {
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Gallery</h1>
        <div className="flex gap-2">
          <UploadDrawingButton variant="outline" />
          <NewDrawingButton />
        </div>
      </div>

      {loading && (
        <p className="text-center text-muted-foreground mt-12">Loading...</p>
      )}
      {error && (
        <p className="text-center text-destructive mt-12">{error}</p>
      )}

      {!loading && !error && scenes.length === 0 && (
        <p className="text-center text-muted-foreground mt-12">
          No public drawings yet. Be the first!
        </p>
      )}

      {!loading && !error && scenes.length > 0 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {scenes.map((scene) => (
              <SceneCard key={scene.id} scene={scene} showAuthor />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
