import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { isAuthenticated, redirectToLogin } from "@/lib/auth";
import { ChatStoreProvider } from "@/state/ChatStore";
import { WorkspacePage } from "@/pages/WorkspacePage";

// Code-split the PDF editor (and the heavy @react-pdf/renderer dep) so it only
// loads when a provider opens the white-label export — keeps the workspace light.
const ReportPdfEditor = lazy(() =>
  import("@/pages/ReportPdfEditor").then((m) => ({ default: m.ReportPdfEditor })),
);

function RequireAuth({ children }: { children: React.ReactNode }) {
  const authed = isAuthenticated();
  useEffect(() => {
    if (!authed) redirectToLogin();
  }, [authed]);

  if (!authed) {
    return (
      <div className="ws-gate">
        <h2>Sign in required</h2>
        <p>Redirecting you to the provider portal to sign in…</p>
        <a className="btn btn-primary" href="/provider-portal/">
          Go to sign in
        </a>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RequireAuth>
            <ChatStoreProvider>
              <WorkspacePage />
            </ChatStoreProvider>
          </RequireAuth>
        }
      />
      <Route
        path="/report-pdf"
        element={
          <RequireAuth>
            <Suspense fallback={<div className="ws-gate"><p>Loading editor…</p></div>}>
              <ReportPdfEditor />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
