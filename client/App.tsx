import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { NavBar } from "./components/NavBar";
import { Gallery } from "./pages/Gallery";
import { MyDrawings } from "./pages/MyDrawings";
import { Editor } from "./pages/Editor";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NavBar />
        <Routes>
          <Route path="/" element={<Gallery />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route
            path="/my"
            element={
              <ProtectedRoute>
                <MyDrawings />
              </ProtectedRoute>
            }
          />
          <Route path="/drawing/:id" element={<Editor />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
