import { Route, Routes } from "react-router-dom";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Concerts from "./pages/Concerts";
import ConcertDetail from "./pages/ConcertDetail";
import BookingStatus from "./pages/BookingStatus";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardRedirect from "./components/DashboardRedirect";
import CustomerDashboard from "./pages/CustomerDashboard";
import CustomerBookingHistory from "./pages/CustomerBookingHistory";
import CustomerBookingDetail from "./pages/CustomerBookingDetail";
import AdminDashboard from "./pages/AdminDashboard";
import AdminConcerts from "./pages/AdminConcerts";
import NotFound from "./pages/NotFound";
import PaymentPage from "./pages/PaymentPage";
import PaymentResult from "./pages/PaymentResult";
import { AdminOrders, AdminOrderDetail } from "./pages/AdminOrders";
import CustomerTickets from "./pages/CustomerTickets";
import AdminTicketCheck from "./pages/AdminTicketCheck";
import CustomerFavorites from "./pages/CustomerFavorites";
import CustomerNotifications from "./pages/CustomerNotifications";
import AdminPaymentReports from "./pages/AdminPaymentReports";
import "./styles/global.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/auth.css";

export default function App() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Lewati ke konten utama</a>
      <Navbar />
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/concerts" element={<Concerts />} />
          <Route path="/concerts/:id" element={<ConcertDetail />} />
          <Route path="/booking-status" element={<BookingStatus />} />
          <Route path="/payments/:bookingCode" element={<PaymentPage />} />
          <Route path="/payment-result/:bookingCode" element={<PaymentResult />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<DashboardRedirect />} />

          <Route element={<ProtectedRoute allowedRoles={["customer"]} />}>
            <Route path="/customer/dashboard" element={<CustomerDashboard />} />
            <Route path="/customer/bookings" element={<CustomerBookingHistory />} />
            <Route path="/customer/bookings/:bookingCode" element={<CustomerBookingDetail />} />
            <Route path="/customer/tickets" element={<CustomerTickets />} />
            <Route path="/customer/favorites" element={<CustomerFavorites />} />
            <Route path="/customer/notifications" element={<CustomerNotifications />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/concerts" element={<AdminConcerts />} />
            <Route path="/admin/orders" element={<AdminOrders />} />
            <Route path="/admin/orders/:bookingCode" element={<AdminOrderDetail />} />
            <Route path="/admin/payments" element={<AdminPaymentReports />} />
            <Route path="/admin/ticket-check" element={<AdminTicketCheck />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
