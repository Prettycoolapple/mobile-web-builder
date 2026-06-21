import { Redirect } from "expo-router";
import React from "react";

import { hasServiceProviderAccess, useAuth } from "@/context/AuthContext";

/**
 * Root entry: send signed-in users to search (tabs), others to welcome.
 * Stack lists this screen first so we never flash auth UI before hydration.
 */
export default function Index() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  if (user) {
    if (user.role === "service_provider" && !hasServiceProviderAccess(user)) {
      return <Redirect href="/(onboarding)/service-provider-welcome" />;
    }
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
