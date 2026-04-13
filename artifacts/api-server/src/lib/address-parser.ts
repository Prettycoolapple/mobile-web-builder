import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

const NZ_ADDRESS_REGEX =
  /\b(\d+[a-zA-Z]?\s+(?:[A-Z][a-z]+\s+){1,4}(?:Road|Street|Avenue|Crescent|Place|Drive|Way|Lane|Terrace|Parade|Close|Grove|Rise|View|Heights|Ridge|Court|Hill|Mews|Quay|Boulevard|Highway|Motorway|Esplanade|Mall|Row|Walk|Path|Track|Rd|St|Ave|Cres|Pl|Dr|Ln|Tce|Pde|Blvd|Hwy)[,\s])/i;

const NZ_SUBURB_CITY =
  /(?:Remuera|Ponsonby|Grey Lynn|Parnell|Herne Bay|Mount Eden|Sandringham|Epsom|Newmarket|Takapuna|Devonport|Birkenhead|Henderson|Manurewa|Papakura|Pukekohe|Whangarei|Hamilton|Tauranga|Wellington|Christchurch|Dunedin|Auckland|North Shore|West Auckland|South Auckland|Waitakere|Manukau|Papamoa|Silverdale|Albany|Howick|Botany|Flat Bush|Pakuranga|Mount Albert|Blockhouse Bay|New Lynn|Glen Innes|Panmure|Ellerslie|One Tree Hill|Royal Oak|Onehunga|Otahuhu|Mangere|Papatoetoe|Otara)/i;

export async function extractNZAddress(message: string): Promise<string | null> {
  const regexMatch = message.match(NZ_ADDRESS_REGEX);
  if (regexMatch) {
    const raw = regexMatch[0].trim().replace(/,$/, "");
    const suburbMatch = message.match(NZ_SUBURB_CITY);
    if (suburbMatch && !raw.toLowerCase().includes(suburbMatch[0].toLowerCase())) {
      return `${raw}, ${suburbMatch[0]}`;
    }
    return raw;
  }

  const looksLikeAddress =
    /\d+/.test(message) &&
    NZ_SUBURB_CITY.test(message);

  if (!looksLikeAddress) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { maxOutputTokens: 64 },
      contents: [
        {
          role: "user",
          parts: [{
            text: `Extract the NZ street address from this message. Reply with ONLY the address in the format "Number Street Name, Suburb, City" or "null" if no address is found.\n\nMessage: "${message}"`,
          }],
        },
      ],
    });

    const extracted = (response.text ?? "").trim();
    if (!extracted || extracted.toLowerCase() === "null" || extracted.length < 5) return null;
    return extracted;
  } catch (err) {
    logger.warn({ err }, "Address extraction via AI failed, falling back to null");
    return null;
  }
}
