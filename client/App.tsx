import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Gallery } from "./pages/Gallery";
import { MyDrawings } from "./pages/MyDrawings";
import { Editor } from "./pages/Editor";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Gallery />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/my" element={<MyDrawings />} />
        <Route path="/drawing/new" element={<Editor />} />
        <Route path="/drawing/:id" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  );
}
