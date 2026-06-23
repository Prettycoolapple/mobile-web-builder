import { useState } from "react";
import { useChatStore } from "@/state/ChatStore";
import { formatRelativeTime } from "@/lib/format";

/** Collapsible left rail of chat history - same sessions the mobile History page shows. */
export function HistorySidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { sessions, currentSessionId, switchSession, startNewChat, deleteSession, renameSession } = useChatStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const beginRename = (id: string, title: string) => {
    setEditingId(id);
    setDraftTitle(title || "Untitled");
  };

  const saveRename = () => {
    if (!editingId) return;
    renameSession(editingId, draftTitle);
    setEditingId(null);
    setDraftTitle("");
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle("");
  };

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
              sessions.map((s) => {
                const isEditing = editingId === s.id;
                const title = s.title || "Untitled";
                return (
                  <div key={s.id} className="ws-history-row">
                    {isEditing ? (
                      <input
                        className="ws-history-rename-input"
                        value={draftTitle}
                        autoFocus
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onBlur={saveRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveRename();
                          if (event.key === "Escape") cancelRename();
                        }}
                        aria-label="Rename conversation"
                      />
                    ) : (
                      <button
                        className={`ws-history-item${s.id === currentSessionId ? " active" : ""}`}
                        onClick={() => switchSession(s.id)}
                      >
                        <span className="ws-history-title">{title}</span>
                        <span className="ws-history-time">{formatRelativeTime(s.updatedAt || s.createdAt)}</span>
                      </button>
                    )}

                    {!isEditing && (
                      <button
                        className="ws-history-action"
                        aria-label="Rename conversation"
                        title="Rename"
                        onClick={() => beginRename(s.id, title)}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      className="ws-history-action danger"
                      aria-label="Delete conversation"
                      title="Delete"
                      onClick={() => {
                        if (confirm("Delete this conversation? This also removes it from your other devices.")) {
                          deleteSession(s.id);
                        }
                      }}
                    >
                      Del
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
}
