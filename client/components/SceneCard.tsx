import { Link } from "react-router-dom";
import { Card, CardContent } from "./ui/card";
import type { SceneListItem } from "../api/scenes";

interface SceneCardProps {
  scene: SceneListItem;
  showAuthor?: boolean;
}

export function SceneCard({ scene, showAuthor = false }: SceneCardProps) {
  const updated = new Date(scene.updated_at);

  return (
    <Link to={`/drawing/${scene.id}`} className="no-underline text-inherit group">
      <Card className="overflow-hidden transition-shadow hover:shadow-md">
        <div className="w-full aspect-[4/3] bg-muted overflow-hidden">
          {scene.thumbnail ? (
            <img
              src={scene.thumbnail}
              alt={scene.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-sm text-muted-foreground">No preview</span>
            </div>
          )}
        </div>
        <CardContent className="p-3">
          <p className="text-sm font-medium text-foreground truncate">{scene.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {showAuthor && scene.user && `${scene.user.username} · `}
            {updated.toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
