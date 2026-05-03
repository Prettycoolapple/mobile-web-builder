import { GoogleGenAI, Modality } from "@google/genai";

const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim();
const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim();

const aiOptions: ConstructorParameters<typeof GoogleGenAI>[0] = {
  apiKey: geminiApiKey ?? "",
};

if (geminiBaseUrl) {
  aiOptions.httpOptions = {
    apiVersion: "",
    baseUrl: geminiBaseUrl,
  };
}

export const ai = geminiApiKey ? new GoogleGenAI(aiOptions) : null;

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  if (!ai) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set to use image generation.",
    );
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
