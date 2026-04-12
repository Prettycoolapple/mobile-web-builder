import type { PropertyCandidate } from "./pre-screen";

export const MOCK_SUBURBS = [
  "remuera", "epsom", "mt-eden", "grey-lynn", "ponsonby",
  "parnell", "sandringham", "onehunga", "new-lynn", "titirangi",
];

type MockEntry = {
  address: string;
  price: number;
  landArea: number;
  zone: string;
  ease: number;
  cost: number;
  roi: number;
  composite: number;
  briefSummary: string;
};

const MOCK_LISTINGS: Record<string, MockEntry[]> = {
  remuera: [
    { address: "14 Victoria Ave, Remuera", price: 1850000, landArea: 728, zone: "MHS", ease: 3.5, cost: 3.0, roi: 3.5, composite: 3.3, briefSummary: "Mixed Housing Suburban — 2 lots possible on 728m². No major overlays. Pre-screen only." },
    { address: "37 Portland Rd, Remuera", price: 2100000, landArea: 892, zone: "MHS", ease: 3.0, cost: 2.5, roi: 3.0, composite: 2.8, briefSummary: "Corner site with subdivision potential. Notable tree may constrain design." },
    { address: "52 Upland Rd, Remuera", price: 1650000, landArea: 607, zone: "MHS", ease: 3.5, cost: 3.5, roi: 3.5, composite: 3.5, briefSummary: "Flat 607m² section. Clean overlays, good value for Remuera." },
    { address: "8 St Vincents Ave, Remuera", price: 1980000, landArea: 810, zone: "SHZ", ease: 2.0, cost: 2.0, roi: 2.0, composite: 2.0, briefSummary: "Single House Zone limits development. Value in site holding or luxury rebuild." },
    { address: "23 Arney Rd, Remuera", price: 2350000, landArea: 1050, zone: "MHU", ease: 4.0, cost: 3.0, roi: 4.0, composite: 3.7, briefSummary: "Mixed Housing Urban — 3–4 lots feasible on 1050m². Strong ROI potential." },
  ],
  epsom: [
    { address: "19 Gillies Ave, Epsom", price: 1450000, landArea: 612, zone: "MHS", ease: 3.5, cost: 3.5, roi: 3.5, composite: 3.5, briefSummary: "Flat Epsom section. MHS zoning supports 2 lots. No overlays flagged." },
    { address: "44 Ranfurly Rd, Epsom", price: 1720000, landArea: 764, zone: "MHS", ease: 3.0, cost: 3.0, roi: 3.5, composite: 3.2, briefSummary: "764m² in school zone. Two lots viable. Good resale market." },
    { address: "7 Waitomo Ave, Epsom", price: 1350000, landArea: 556, zone: "MHS", ease: 3.5, cost: 4.0, roi: 3.5, composite: 3.7, briefSummary: "Compact but clean section. Cost-effective demolish and build opportunity." },
    { address: "31 Pah Rd, Epsom", price: 1900000, landArea: 900, zone: "MHU", ease: 4.0, cost: 3.0, roi: 4.0, composite: 3.7, briefSummary: "MHU-zoned with street frontage. 3 lots feasible. Strong Epsom demand." },
    { address: "5 Owens Rd, Epsom", price: 2200000, landArea: 1120, zone: "MHU", ease: 4.0, cost: 2.5, roi: 4.0, composite: 3.5, briefSummary: "Large MHU section. Price premium but lot yield justifies entry cost." },
  ],
  "mt-eden": [
    { address: "28 Balmoral Rd, Mt Eden", price: 1380000, landArea: 600, zone: "MHS", ease: 3.5, cost: 3.5, roi: 3.5, composite: 3.5, briefSummary: "600m² MHS site. Two lots possible. Mt Eden demand remains strong." },
    { address: "15 Grange Rd, Mt Eden", price: 1650000, landArea: 760, zone: "MHU", ease: 4.0, cost: 3.5, roi: 4.0, composite: 3.9, briefSummary: "MHU zoning. 3 lots viable. Volcanic viewshaft may restrict height on rear lot." },
    { address: "42 Esplanade Rd, Mt Eden", price: 1200000, landArea: 530, zone: "MHS", ease: 3.0, cost: 4.0, roi: 3.5, composite: 3.6, briefSummary: "Modest lot but good value. Cost efficiency is the standout here." },
    { address: "9 Sargent Ave, Mt Eden", price: 1750000, landArea: 820, zone: "MHU", ease: 3.5, cost: 3.0, roi: 4.0, composite: 3.6, briefSummary: "Rear access possible. 3 lots feasible on this MHU site." },
    { address: "67 Valley Rd, Mt Eden", price: 1500000, landArea: 680, zone: "MHS", ease: 3.0, cost: 3.0, roi: 3.0, composite: 3.0, briefSummary: "Slight slope may require retaining. Two lots achievable." },
  ],
  "grey-lynn": [
    { address: "12 Tuarangi Rd, Grey Lynn", price: 1250000, landArea: 540, zone: "MHU", ease: 4.0, cost: 4.0, roi: 4.0, composite: 4.0, briefSummary: "Strong MHU site. 2–3 lots viable. One of Grey Lynn's best value offerings." },
    { address: "38 Francis St, Grey Lynn", price: 1400000, landArea: 625, zone: "MHU", ease: 3.5, cost: 3.5, roi: 4.0, composite: 3.7, briefSummary: "625m² with dual-access potential. Demand for terraced housing is high here." },
    { address: "5 Hakanoa St, Grey Lynn", price: 1600000, landArea: 700, zone: "MHU", ease: 3.5, cost: 3.0, roi: 3.5, composite: 3.4, briefSummary: "Heritage overlay on neighbouring property — check boundary. 2 lots confirmed." },
    { address: "21 Surrey Cres, Grey Lynn", price: 1750000, landArea: 780, zone: "THAB", ease: 4.5, cost: 3.0, roi: 4.5, composite: 4.0, briefSummary: "THAB! High density possible. Terraced housing or 4-unit development viable." },
    { address: "9 Westmoreland St, Grey Lynn", price: 1100000, landArea: 460, zone: "MHU", ease: 3.5, cost: 4.0, roi: 3.5, composite: 3.7, briefSummary: "Compact but affordable. 2 lots viable, good yield for entry-level investors." },
  ],
  ponsonby: [
    { address: "44 Pompallier Tce, Ponsonby", price: 1950000, landArea: 620, zone: "MHU", ease: 3.5, cost: 2.5, roi: 3.5, composite: 3.2, briefSummary: "Heritage overlay may apply — verify. Premium Ponsonby address commands strong GDV." },
    { address: "7 Collingwood St, Ponsonby", price: 2100000, landArea: 680, zone: "MHU", ease: 3.0, cost: 2.5, roi: 3.5, composite: 3.1, briefSummary: "Tight margins but high end-value. Best for experienced developer or owner-occupier." },
    { address: "33 Richmond Rd, Ponsonby", price: 1800000, landArea: 710, zone: "THAB", ease: 4.5, cost: 3.0, roi: 4.5, composite: 4.1, briefSummary: "THAB zoned in Ponsonby — rare. Multiple units possible. High demand location." },
    { address: "18 Jervois Rd, Ponsonby", price: 2400000, landArea: 800, zone: "MHU", ease: 3.0, cost: 2.0, roi: 3.0, composite: 2.7, briefSummary: "Premium price erodes margin. Worth running a full analysis on lot yield potential." },
    { address: "52 Crummer Rd, Ponsonby", price: 1600000, landArea: 590, zone: "MHU", ease: 3.5, cost: 3.5, roi: 4.0, composite: 3.7, briefSummary: "Good value for Ponsonby. 2 lots achievable. Close to Karangahape Road amenities." },
  ],
  parnell: [
    { address: "14 Garfield St, Parnell", price: 1700000, landArea: 640, zone: "MHS", ease: 3.0, cost: 3.0, roi: 3.5, composite: 3.2, briefSummary: "MHS Parnell site. Strong end-value but heritage character area — check overlays." },
    { address: "29 Judges Bay Rd, Parnell", price: 2200000, landArea: 750, zone: "MHS", ease: 2.5, cost: 2.0, roi: 3.0, composite: 2.5, briefSummary: "Premium harbourside. Heritage and viewshaft restrictions likely. Full analysis required." },
    { address: "5 Cheshire St, Parnell", price: 1500000, landArea: 600, zone: "MHU", ease: 3.5, cost: 3.5, roi: 4.0, composite: 3.7, briefSummary: "MHU site near Parnell Village. 2–3 lots viable. Strong buyer demand." },
    { address: "41 St Georges Bay Rd, Parnell", price: 1900000, landArea: 700, zone: "MHU", ease: 3.0, cost: 2.5, roi: 3.5, composite: 3.1, briefSummary: "Good lot yield but price reflects premium location. Margins workable for 3 lots." },
    { address: "18 Titoki St, Parnell", price: 1350000, landArea: 550, zone: "MHS", ease: 3.5, cost: 3.5, roi: 3.5, composite: 3.5, briefSummary: "Well-priced for Parnell. 2 lots feasible. No major overlay concerns flagged." },
  ],
  sandringham: [
    { address: "32 Burnley Tce, Sandringham", price: 1100000, landArea: 620, zone: "MHU", ease: 4.0, cost: 4.5, roi: 4.5, composite: 4.3, briefSummary: "Excellent value. MHU site. 2–3 lots, low cost base, strong ROI." },
    { address: "7 Halsey St, Sandringham", price: 1050000, landArea: 580, zone: "MHU", ease: 4.0, cost: 4.5, roi: 4.0, composite: 4.2, briefSummary: "Affordable MHU section. Solid cost efficiency and good suburb demand." },
    { address: "19 King Edward Ave, Sandringham", price: 1200000, landArea: 650, zone: "MHU", ease: 3.5, cost: 4.0, roi: 4.0, composite: 3.9, briefSummary: "650m² MHU. Could do 3 lots. One of Auckland's best value development suburbs." },
    { address: "44 Windmill Rd, Sandringham", price: 1400000, landArea: 820, zone: "MHU", ease: 4.0, cost: 4.0, roi: 4.5, composite: 4.2, briefSummary: "Large section. 3 lots minimum. High composite score for price paid." },
    { address: "11 Earlsfield Rd, Sandringham", price: 980000, landArea: 540, zone: "MHS", ease: 3.5, cost: 4.5, roi: 3.5, composite: 3.9, briefSummary: "Budget friendly. 2 lots on MHS. Best entry-level development opportunity." },
  ],
  onehunga: [
    { address: "16 Church St, Onehunga", price: 950000, landArea: 650, zone: "MHU", ease: 4.0, cost: 4.5, roi: 4.5, composite: 4.3, briefSummary: "2–3 lots viable. Affordable entry. Onehunga rezoning has driven strong uplift." },
    { address: "38 Selwyn St, Onehunga", price: 880000, landArea: 600, zone: "MHU", ease: 4.0, cost: 5.0, roi: 4.5, composite: 4.5, briefSummary: "Exceptional cost score. MHU section, flat, clean title. High ROI potential." },
    { address: "5 Grey St, Onehunga", price: 1050000, landArea: 700, zone: "MHU", ease: 4.0, cost: 4.5, roi: 4.5, composite: 4.4, briefSummary: "700m² gives 3 lots. Infrastructure likely on boundary. Good value." },
    { address: "21 Princes St, Onehunga", price: 1200000, landArea: 750, zone: "MHU", ease: 3.5, cost: 4.0, roi: 4.5, composite: 4.1, briefSummary: "Slightly higher price but 3 lots achievable. Onehunga demand continues to grow." },
    { address: "9 Arthur St, Onehunga", price: 820000, landArea: 560, zone: "MHS", ease: 3.5, cost: 5.0, roi: 3.5, composite: 4.0, briefSummary: "Best value on this list. 2 lots. Low build cost for MHS site." },
  ],
  "new-lynn": [
    { address: "47 Delta Ave, New Lynn", price: 800000, landArea: 620, zone: "MHU", ease: 4.0, cost: 5.0, roi: 4.5, composite: 4.5, briefSummary: "Outstanding value. MHU, flat, minimal overlays. 2–3 lots with strong margins." },
    { address: "12 Rankin Ave, New Lynn", price: 850000, landArea: 680, zone: "MHU", ease: 4.0, cost: 5.0, roi: 4.5, composite: 4.5, briefSummary: "Flat 680m² MHU section. 3 lots possible. One of Auckland's best cost-efficiency suburbs." },
    { address: "33 McLeod Rd, New Lynn", price: 920000, landArea: 740, zone: "MHU", ease: 3.5, cost: 4.5, roi: 4.5, composite: 4.2, briefSummary: "Near New Lynn town centre. Transport links boost rental and resale value." },
    { address: "8 Astley Ave, New Lynn", price: 780000, landArea: 580, zone: "MHU", ease: 4.0, cost: 5.0, roi: 4.0, composite: 4.3, briefSummary: "Well-priced with good lot yield. Excellent for first-time developer." },
    { address: "25 Portage Rd, New Lynn", price: 950000, landArea: 790, zone: "MHU", ease: 4.0, cost: 4.5, roi: 4.5, composite: 4.4, briefSummary: "Large section. 3–4 lots achievable. Modest price for lot yield." },
  ],
  titirangi: [
    { address: "14 Konini Rd, Titirangi", price: 1100000, landArea: 800, zone: "LSZ", ease: 1.5, cost: 3.0, roi: 1.5, composite: 2.0, briefSummary: "Waitakere Heritage Area — strict development limits. Best as lifestyle hold." },
    { address: "31 Titirangi Rd, Titirangi", price: 950000, landArea: 1200, zone: "LSZ", ease: 1.5, cost: 2.5, roi: 1.5, composite: 1.8, briefSummary: "Large section but heritage constraints dominate. Very limited development upside." },
    { address: "6 Domain Rd, Titirangi", price: 1250000, landArea: 900, zone: "MHS", ease: 2.5, cost: 2.5, roi: 2.5, composite: 2.5, briefSummary: "Outside heritage area. Steep terrain adds cost. 2 lots potentially achievable." },
    { address: "22 Wood Bay Rd, Titirangi", price: 1050000, landArea: 1100, zone: "LSZ", ease: 1.5, cost: 2.0, roi: 1.5, composite: 1.7, briefSummary: "Bush setting. No subdivision potential in LSZ. Lifestyle property only." },
    { address: "9 Atkinson Rd, Titirangi", price: 900000, landArea: 750, zone: "MHS", ease: 2.5, cost: 3.0, roi: 2.5, composite: 2.7, briefSummary: "MHS but outside main village. Moderate slope. One additional dwelling possible." },
  ],
};

function toSlug(suburb: string): string {
  return suburb.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function entryToCandidate(e: MockEntry): PropertyCandidate {
  return {
    address: e.address,
    price: e.price,
    landArea: e.landArea,
    zone: e.zone,
    scores: { ease: e.ease, cost: e.cost, roi: e.roi, composite: e.composite },
    briefSummary: e.briefSummary,
  };
}

export function getMockListings(suburb?: string): PropertyCandidate[] {
  if (!suburb) {
    const all: PropertyCandidate[] = [];
    for (const entries of Object.values(MOCK_LISTINGS)) {
      all.push(...entries.map(entryToCandidate));
    }
    return all.sort((a, b) => b.scores.composite - a.scores.composite).slice(0, 10);
  }

  const slug = toSlug(suburb);
  const entries = MOCK_LISTINGS[slug];
  if (entries) return entries.map(entryToCandidate);

  const partial = Object.entries(MOCK_LISTINGS).find(([k]) => k.includes(slug) || slug.includes(k));
  if (partial) return partial[1].map(entryToCandidate);

  const all: PropertyCandidate[] = [];
  for (const list of Object.values(MOCK_LISTINGS)) {
    all.push(...list.map(entryToCandidate));
  }
  return all.sort((a, b) => b.scores.composite - a.scores.composite).slice(0, 5);
}
