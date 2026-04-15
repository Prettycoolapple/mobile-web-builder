import { Stack } from "expo-router";
import React from "react";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="sales-agent-welcome" />
      <Stack.Screen name="service-provider-welcome" />
    </Stack>
  );
}
