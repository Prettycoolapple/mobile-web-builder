import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useChat } from "@/context/ChatContext";

export default function HomeRedirect() {
  const { startNewChat } = useChat();
  const router = useRouter();

  useEffect(() => {
    startNewChat();
    router.replace("/(tabs)");
  }, []);

  return null;
}
