import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { exportToBlob } from "@excalidraw/excalidraw";
import { createScene } from "../api/scenes";
import { logger } from "../api/logger";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

interface UploadDrawingButtonProps {
  className?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  children?: React.ReactNode;
}

/**
 * Opens a file picker for .excalidraw/.json files, validates and creates
 * a scene via the API, then navigates to /drawing/:id.
 */
export function UploadDrawingButton({ className, variant = "outline", size = "default", children }: UploadDrawingButtonProps) {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);

  const handleClick = useCallback(() => {
    if (uploading) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".excalidraw,.json";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      let parsed: Record<string, unknown>;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        alert("File is not valid JSON");
        return;
      }

      const title = file.name.replace(/\.(excalidraw|json)$/i, "") || "Untitled";

      setUploading(true);
      try {
        // Generate thumbnail from parsed scene data (best-effort)
        let thumbnail: string | undefined;
        const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
        const hasVisibleElements = elements.length > 0 && elements.some((el: any) => !el.isDeleted);

        if (hasVisibleElements) {
          try {
            const blob = await exportToBlob({
              elements,
              appState: {
                ...(parsed.appState as object || {}),
                exportWithDarkMode: false,
                exportBackground: true,
              },
              files: (parsed.files as any) || {},
              maxWidthOrHeight: 300,
            });

            thumbnail = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (err) {
            logger.error("UploadDrawingButton: thumbnail generation failed", { error: String(err) });
          }
        }

        const scene = await createScene({
          title,
          data: parsed as object,
          ...(thumbnail && { thumbnail }),
        });
        navigate(`/drawing/${scene.id}`);
      } catch (err: any) {
        if (err.status === 422) {
          alert("Invalid Excalidraw file: the scene data failed validation");
        } else {
          alert("Upload failed");
        }
        setUploading(false);
      }
    };

    input.click();
  }, [uploading, navigate]);

  return (
    <Button
      onClick={handleClick}
      disabled={uploading}
      variant={variant}
      size={size}
      className={cn(className)}
    >
      {uploading ? (
        "Uploading..."
      ) : children ? (
        children
      ) : (
        <>
          <Upload className="h-4 w-4 mr-1" />
          Upload
        </>
      )}
    </Button>
  );
}
