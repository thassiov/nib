import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { listMyScenes, deleteScene } from "../api/scenes";
import { SceneCard } from "../components/SceneCard";
import { NewDrawingButton } from "../components/NewDrawingButton";
import { UploadDrawingButton } from "../components/UploadDrawingButton";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import type { SceneListItem } from "../api/scenes";

export function MyDrawings() {
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground">My Drawings</h1>
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
        <div className="text-center mt-12">
          <p className="text-muted-foreground mb-4">You haven't created any drawings yet.</p>
          <div className="flex justify-center gap-2">
            <UploadDrawingButton variant="outline">Upload a drawing</UploadDrawingButton>
            <NewDrawingButton>Create your first drawing</NewDrawingButton>
          </div>
        </div>
      )}

      {!loading && !error && scenes.length > 0 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {scenes.map((scene) => (
              <div key={scene.id} className="flex flex-col">
                <SceneCard scene={scene} />
                <div className="flex items-center justify-between px-0.5 mt-1.5">
                  <Badge variant={scene.is_public ? "secondary" : "outline"} className="text-xs">
                    {scene.is_public ? "Public" : "Private"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-7 px-2"
                    onClick={() => handleDelete(scene.id, scene.title)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
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
