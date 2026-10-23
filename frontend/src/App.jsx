
import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Concerts from "./pages/Concerts";
import ConcertDetail from "./pages/ConcertDetail";
import BookingStatus from "./pages/BookingStatus";
import NotFound from "./pages/NotFound";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/pages.css";

export default function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/concerts" element={<Concerts />} />
          <Route path="/concerts/:id" element={<ConcertDetail />} />
          <Route path="/booking-status" element={<BookingStatus />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
