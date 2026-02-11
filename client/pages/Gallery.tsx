import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function Gallery() {
  const { user } = useAuth();

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1>Gallery</h1>
        {user && (
          <Link
            to="/drawing/new"
            style={{
              padding: "8px 16px",
              backgroundColor: "#1a1a1a",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 4,
              fontSize: 14,
            }}
          >
            New Drawing
          </Link>
        )}
      </div>
      <p style={{ color: "#666" }}>Public drawings will appear here.</p>
    </div>
  );
}
