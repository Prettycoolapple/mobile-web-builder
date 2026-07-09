import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";

import { hasServiceProviderAccess, useAuth } from "@/context/AuthContext";
import { storePendingShareToken } from "@/lib/propertyShares";

export default function ShareTokenRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const { user, isLoading } = useAuth();
  const [stored, setStored] = useState(false);

  const rawToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStored(true);
      return;
    }
    storePendingShareToken(token)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!stored || isLoading) return null;

  if (!user) return <Redirect href="/(auth)/welcome" />;
  if (user.role === "service_provider" && !hasServiceProviderAccess(user)) {
    return <Redirect href="/(onboarding)/service-provider-welcome" />;
  }
  return <Redirect href="/(tabs)" />;
}
