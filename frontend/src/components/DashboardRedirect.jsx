import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function DashboardRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <section className="dashboard-page">
        <p role="status">Memuat dashboard...</p>
      </section>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Navigate
      to={user.role === "admin" ? "/admin/dashboard" : "/customer/dashboard"}
      replace
    />
  );
}
