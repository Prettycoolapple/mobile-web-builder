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
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
