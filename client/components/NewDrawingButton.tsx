import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { createScene } from "../api/scenes";

interface NewDrawingButtonProps {
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Creates an empty scene via the API, then navigates to /drawing/:id.
 * This avoids the /drawing/new route entirely — the Editor always
 * opens with a real scene ID and never needs a first-time create flow.
 */
export function NewDrawingButton({ style, children }: NewDrawingButtonProps) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const handleClick = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const scene = await createScene({
        title: "Untitled",
        data: { elements: [], appState: {}, files: {} },
      });
      navigate(`/drawing/${scene.id}`);
    } catch {
      alert("Failed to create drawing");
      setCreating(false);
    }
  }, [creating, navigate]);

  return (
    <button onClick={handleClick} disabled={creating} style={style}>
      {creating ? "Creating..." : children}
    </button>
  );
}
