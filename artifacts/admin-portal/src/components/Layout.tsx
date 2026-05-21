import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { clearSession } from "@/lib/auth";

export default function Layout() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    apiGet<{ total: number }>("/admin/providers/pending")
      .then((data) => {
        if (!cancelled) setPendingCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function logout(): void {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">Project Alpha — Admin</div>
        <NavLink to="/dashboard" className={({ isActive }) => (isActive ? "active" : "")}>
          Dashboard
        </NavLink>
        <NavLink to="/users" className={({ isActive }) => (isActive ? "active" : "")}>
          Users
        </NavLink>
        <NavLink
          to="/pending-providers"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span>Pending verifications</span>
          {pendingCount !== null && pendingCount > 0 && (
            <span className="sidebar-badge">{pendingCount}</span>
          )}
        </NavLink>
        <NavLink to="/inquiries" className={({ isActive }) => (isActive ? "active" : "")}>
          Inquiries
        </NavLink>
        <button className="sidebar-logout" onClick={logout}>
          Log out
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
