import { Stack } from "expo-router";
import React from "react";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="signup-general" />
      <Stack.Screen name="signup-agent" />
      <Stack.Screen name="signup-provider" />
      <Stack.Screen name="welcome-agent" />
      <Stack.Screen name="welcome-provider" />
    </Stack>
  );
}
