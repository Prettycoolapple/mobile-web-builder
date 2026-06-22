import { useChatStore } from "@/state/ChatStore";
import { formatRelativeTime } from "@/lib/format";

/** Collapsible left rail of chat history — same sessions the mobile History page shows. */
export function HistorySidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { sessions, currentSessionId, switchSession, startNewChat, deleteSession } = useChatStore();

  return (
    <aside className={`ws-sidebar${collapsed ? " collapsed" : ""}`} aria-label="Chat history">
      <div className="ws-sidebar-head">
        <button className="btn-ghost" onClick={onToggle} aria-label={collapsed ? "Expand" : "Collapse"} title="Toggle history">
          ☰
        </button>
        {!collapsed && <span className="ws-brand">Work Space</span>}
      </div>

      {!collapsed && (
        <>
          <button className="ws-new-btn" onClick={startNewChat}>
            <span>＋</span> New analysis
          </button>

          <div className="ws-history-list">
            {sessions.length === 0 ? (
              <p className="ws-history-empty">
                Your searches and analyses will appear here — synced with your mobile app.
              </p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} style={{ position: "relative" }}>
                  <button
                    className={`ws-history-item${s.id === currentSessionId ? " active" : ""}`}
                    onClick={() => switchSession(s.id)}
                  >
                    <span className="ws-history-title">{s.title || "Untitled"}</span>
                    <span className="ws-history-time">{formatRelativeTime(s.updatedAt || s.createdAt)}</span>
                  </button>
                  <button
                    className="ws-history-del"
                    aria-label="Delete conversation"
                    title="Delete"
                    onClick={() => {
                      if (confirm("Delete this conversation? This also removes it from your other devices.")) {
                        deleteSession(s.id);
                      }
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
