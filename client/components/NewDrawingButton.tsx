import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { createScene } from "../api/scenes";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface NewDrawingButtonProps {
  className?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  children?: React.ReactNode;
}

/**
 * Creates an empty scene via the API, then navigates to /drawing/:id.
 */
export function NewDrawingButton({ className, variant = "default", size = "default", children }: NewDrawingButtonProps) {
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
    <Button
      onClick={handleClick}
      disabled={creating}
      variant={variant}
      size={size}
      className={cn(className)}
    >
      {creating ? (
        "Creating..."
      ) : children ? (
        children
      ) : (
        <>
          <Plus className="h-4 w-4 mr-1" />
          New Drawing
        </>
      )}
    </Button>
  );
}
