import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { clearSession } from "@/lib/auth";

const MH_LAST_SEEN_KEY = "admin.messageHub.lastSeenAt";
const MH_BADGE_POLL_MS = 20000;

export default function Layout() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [pendingListingsCount, setPendingListingsCount] = useState<
    number | null
  >(null);
  const [newChatsCount, setNewChatsCount] = useState<number | null>(null);
  const [limTitleLeadsPendingCount, setLimTitleLeadsPendingCount] = useState<
    number | null
  >(null);
  const navigate = useNavigate();
  const location = useLocation();
  const onMessageHub = location.pathname.startsWith("/message-hub");
  const onLimTitleLeads = location.pathname.startsWith("/lim-title-leads");

  useEffect(() => {
    let cancelled = false;
    apiGet<{ total: number }>("/admin/providers/pending")
      .then((data) => {
        if (!cancelled) setPendingCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setPendingCount(null);
      });
    apiGet<{ total: number }>("/admin/listings/pending-count")
      .then((data) => {
        if (!cancelled) setPendingListingsCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setPendingListingsCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // While the admin is on the Message Hub page itself, the page keeps the
    // "last seen" marker fresh — the sidebar badge only needs to reflect
    // chats that arrived while they were elsewhere.
    if (onMessageHub) {
      setNewChatsCount(0);
      return;
    }
    let cancelled = false;
    function poll() {
      const since = localStorage.getItem(MH_LAST_SEEN_KEY) ?? "";
      apiGet<{ total: number }>(
        `/admin/message-hub/new-chats-count?since=${encodeURIComponent(since)}`,
      )
        .then((data) => {
          if (!cancelled) setNewChatsCount(data.total);
        })
        .catch(() => {
          if (!cancelled) setNewChatsCount(null);
        });
    }
    poll();
    const timer = window.setInterval(poll, MH_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onMessageHub]);

  useEffect(() => {
    // The leads page itself marks everything viewed on load, so while it's
    // open the badge reads zero; elsewhere it polls for new/re-requested
    // leads (a fresh lastRequestedAt, including buyer re-requests after the
    // cooldown window).
    if (onLimTitleLeads) {
      setLimTitleLeadsPendingCount(0);
      return;
    }
    let cancelled = false;
    function poll() {
      apiGet<{ total: number }>("/admin/lim-title-leads/pending-count")
        .then((data) => {
          if (!cancelled) setLimTitleLeadsPendingCount(data.total);
        })
        .catch(() => {
          if (!cancelled) setLimTitleLeadsPendingCount(null);
        });
    }
    poll();
    const timer = window.setInterval(poll, MH_BADGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onLimTitleLeads]);

  function logout(): void {
    clearSession();
    navigate("/login", { replace: true });
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">Project Alpha — Admin</div>
        <NavLink
          to="/dashboard"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/users"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Users
        </NavLink>
        <NavLink
          to="/agents"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span>Sales Agents</span>
          {pendingListingsCount !== null && pendingListingsCount > 0 && (
            <span className="sidebar-badge">{pendingListingsCount}</span>
          )}
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
        <NavLink
          to="/inquiries"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Inquiries
        </NavLink>
        <NavLink
          to="/message-hub"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span>Message Hub</span>
          {newChatsCount !== null && newChatsCount > 0 && (
            <span className="sidebar-badge">{newChatsCount}</span>
          )}
        </NavLink>
        <NavLink
          to="/lim-title-leads"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span>LIM/Title Leads</span>
          {limTitleLeadsPendingCount !== null && limTitleLeadsPendingCount > 0 && (
            <span className="sidebar-badge">{limTitleLeadsPendingCount}</span>
          )}
        </NavLink>
        <NavLink
          to="/most-watched"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Most watched
        </NavLink>
        <NavLink
          to="/property-cache"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Property reports
        </NavLink>
        <NavLink
          to="/security"
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          Security
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
