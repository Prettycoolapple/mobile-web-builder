import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import RequireAdmin from "@/components/RequireAdmin";
import LoginPage from "@/pages/Login";
import DashboardPage from "@/pages/Dashboard";
import UsersPage from "@/pages/Users";
import UserDetailPage from "@/pages/UserDetail";
import InquiriesPage from "@/pages/Inquiries";
import PendingProvidersPage from "@/pages/PendingProviders";
import PropertyCachePage from "@/pages/PropertyCache";
import AgentsPage from "@/pages/Agents";
import AgentDetailPage from "@/pages/AgentDetail";
import ListingDetailPage from "@/pages/ListingDetail";
import SecurityPage from "@/pages/Security";
import MessageHubPage from "@/pages/MessageHub";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAdmin>
            <Layout />
          </RequireAdmin>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
        <Route path="/pending-providers" element={<PendingProvidersPage />} />
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/property-cache" element={<PropertyCachePage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:agentId" element={<AgentDetailPage />} />
        <Route path="/listings/:listingId" element={<ListingDetailPage />} />
        <Route path="/message-hub" element={<MessageHubPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
