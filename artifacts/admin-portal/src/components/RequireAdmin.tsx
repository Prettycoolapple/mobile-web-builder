import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isAdminAuthenticated } from "@/lib/auth";

export default function RequireAdmin({ children }: { children: ReactNode }): ReactNode {
  const location = useLocation();
  if (!isAdminAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
