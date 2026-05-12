import { Redirect } from "expo-router";
import React from "react";

import { useAuth } from "@/context/AuthContext";

/**
 * Root entry: send signed-in users to search (tabs), others to welcome.
 * Stack lists this screen first so we never flash auth UI before hydration.
 */
export default function Index() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  if (user) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/welcome" />;
}
