import { Link } from "react-router-dom";
import type { SceneListItem } from "../api/scenes";

interface SceneCardProps {
  scene: SceneListItem;
  showAuthor?: boolean;
}

export function SceneCard({ scene, showAuthor = false }: SceneCardProps) {
  const updated = new Date(scene.updated_at);

  return (
    <Link to={`/drawing/${scene.id}`} style={styles.card}>
      <div style={styles.preview}>
        {scene.thumbnail ? (
          <img src={scene.thumbnail} alt={scene.title} style={styles.thumbnail} />
        ) : (
          <div style={styles.placeholder}>
            <span style={styles.placeholderText}>No preview</span>
          </div>
        )}
      </div>
      <div style={styles.info}>
        <span style={styles.title}>{scene.title}</span>
        <span style={styles.meta}>
          {showAuthor && scene.user && `${scene.user.username} · `}
          {updated.toLocaleDateString()}
        </span>
      </div>
    </Link>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid #e0e0e0",
    borderRadius: 6,
    overflow: "hidden",
    textDecoration: "none",
    color: "inherit",
    transition: "box-shadow 0.15s",
    backgroundColor: "#fff",
  },
  preview: {
    width: "100%",
    aspectRatio: "4 / 3",
    backgroundColor: "#f5f5f5",
    overflow: "hidden",
  },
  thumbnail: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  placeholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 13,
    color: "#bbb",
  },
  info: {
    padding: "8px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: 500,
    color: "#333",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    fontSize: 12,
    color: "#999",
  },
};
