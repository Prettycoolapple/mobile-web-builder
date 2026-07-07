import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

const STREET_TYPE =
  "(?:road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)";

const STREET_NUMBER = "(?:[A-Za-z]?\\d+[A-Za-z]?\\s*/\\s*)?\\d+[A-Za-z]?";

const NZ_ADDRESS_REGEX =
  new RegExp(
    // street number + street name + street type + optional locality tail
    `\\b(${STREET_NUMBER}\\s+[\\p{L}'-]+(?:\\s+[\\p{L}'-]+){0,5}\\s+${STREET_TYPE}(?:\\s+[\\p{L}'-]+){0,3})\\b`,
    "iu",
  );

const STREET_TYPE_REGEX = new RegExp(`\\b${STREET_TYPE}\\b`, "i");

const NZ_SUBURB_CITY =
  /(?:St Heliers|Saint Heliers|Mission Bay|Kohimarama|Orakei|Remuera|Ponsonby|Grey Lynn|Parnell|Herne Bay|Mount Eden|Sandringham|Epsom|Newmarket|Takapuna|Devonport|Birkenhead|Henderson|Manurewa|Papakura|Pukekohe|Whangarei|Hamilton|Whitiora|Tauranga|Wellington|Christchurch|Dunedin|Auckland|North Shore|West Auckland|South Auckland|Waitakere|Manukau|Papamoa|Silverdale|Albany|Howick|Botany|Flat Bush|Pakuranga|Mount Albert|Blockhouse Bay|New Lynn|Glen Innes|Panmure|Ellerslie|One Tree Hill|Royal Oak|Onehunga|Otahuhu|Mangere|Papatoetoe|Otara|Mellons Bay|Melons Bay|Bucklands Beach|Eastern Beach|Half Moon Bay|Beachlands|Maraetai|Cockle Bay|Shelly Park|Farm Cove|Highland Park|Sunnyhills|Dannemora|Somerville|Glendowie|Meadowbank|St Johns|Saint Johns|Point England|Stonefields|Mount Wellington|Sylvia Park|Penrose|Te Atatu|Te Atatu Peninsula|Te Atatu South|Kelston|Glen Eden|Titirangi|Green Bay|Avondale|Waterview|Point Chevalier|Westmere|Freemans Bay|Grafton|Kingsland|Morningside|Mt Roskill|Mount Roskill|Three Kings|Hillsborough|Lynfield|Waiuku|Karaka|Drury|Clevedon|Whitford|Brookby|Turanga|Orewa|Whangaparaoa|Gulf Harbour|Stanmore Bay|Red Beach|Hibiscus Coast|Millwater|Warkworth|Matakana|Snells Beach|Algies Bay|Browns Bay|Rothesay Bay|Murrays Bay|Mairangi Bay|Campbells Bay|Castor Bay|Milford|Sunnynook|Forrest Hill|Bayswater|Belmont|Hauraki|Northcote|Hillcrest|Glenfield|Beach Haven|Birkdale|Chatswood|Unsworth Heights|Pinehill|Windsor Park|Oteha|Totara Vale|Bayview|Torbay|Long Bay|Okura|Stillwater)/i;

function cleanAddress(raw: string): string {
  return raw
    .replace(/[，]/g, ",")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .replace(/[.;!?，。]+$/g, "");
}

function streetLineText(raw: string): string {
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^(?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-z]?$/i.test(parts[0]!)) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0] ?? raw;
}

function hasNumberedStreetLine(raw: string): boolean {
  return /^(?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-z]?\s+.*[\p{L}]/iu.test(streetLineText(raw));
}

function isPlausibleAddress(raw: string): boolean {
  if (!/\d+/.test(raw) || (!STREET_TYPE_REGEX.test(raw) && !raw.includes(","))) return false;
  // Must look like a numbered street lot (rejects whole-road / suburb-only strings from the AI path).
  if (NZ_ADDRESS_REGEX.test(raw)) return true;
  if (/\b(?:unit|apt|apartment)\s*\d+[a-z]?,?\s*\d+[a-zA-Z]?\s+/i.test(raw)) return true;
  if (raw.includes(",") && hasNumberedStreetLine(raw)) return true;
  return false;
}

export async function extractNZAddress(message: string): Promise<string | null> {
  const regexMatch = message.match(NZ_ADDRESS_REGEX);
  if (regexMatch) {
    const raw = cleanAddress(regexMatch[0]);
    const suburbMatch = message.match(NZ_SUBURB_CITY);
    if (suburbMatch && !raw.toLowerCase().includes(suburbMatch[0].toLowerCase()) && STREET_TYPE_REGEX.test(raw)) {
      return cleanAddress(`${raw}, ${suburbMatch[0]}`);
    }
    return raw;
  }

  const looksLikeAddress =
    /\d+/.test(message) &&
    (NZ_SUBURB_CITY.test(message) || STREET_TYPE_REGEX.test(message));

  if (!looksLikeAddress) return null;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 64 },
      contents: [
        {
          role: "user",
          parts: [{
            text: `Extract the NZ street address from this message. Reply with ONLY the address in the format "Number Street Name, Suburb, City" or "null" if no address is found.\n\nCRITICAL: Extract the address EXACTLY as the user typed it. Do NOT correct, normalise, or substitute suburb/street names. If the user wrote "melons bay", output "Melons Bay" — do NOT change it to "Mission Bay" or any other suburb. Preserve misspellings. Your job is faithful extraction, not correction.\n\nMessage: "${message}"`,
          }],
        },
      ],
    });

    const extracted = cleanAddress((response.text ?? "").replace(/^["']|["']$/g, "").trim());
    if (!extracted || extracted.toLowerCase() === "null" || extracted.length < 5) return null;
    return isPlausibleAddress(extracted) ? extracted : null;
  } catch (err) {
    logger.warn({ err }, "Address extraction via AI failed, falling back to null");
    return null;
  }
}
