// ============================================================
// Gavi priority districts — the intervention geography this tool
// is being rolled out in. Pure data + lookups (no React, no
// Firebase) so the matching stays harness-testable.
// ============================================================
import { normalizeGeoName, resolveOptionValue } from "./geoNames";

/** Whether an analysis counts every district or only the Gavi intervention ones. */
export type DistrictScope = "ALL" | "PRIORITY";

export const DISTRICT_SCOPE_OPTIONS: Array<{ value: DistrictScope; label: string }> = [
  { value: "ALL", label: "All districts" },
  { value: "PRIORITY", label: "Gavi priority districts" },
];

export function districtScopeLabel(scope: DistrictScope): string {
  return DISTRICT_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? "All districts";
}

/**
 * State -> the districts Gavi named as intervention areas. Names are the
 * programme's own spelling; every lookup below normalizes before comparing, so
 * a state's boundary-file or CSV spelling does not have to match character for
 * character.
 */
export const PRIORITY_DISTRICTS: Readonly<Record<string, readonly string[]>> = {
  "Arunachal Pradesh": [
    "Changlang", "East Kameng", "East Siang", "Kamle", "Longding", "Lower Subansiri",
    "Namsai", "Papum Pare", "Siang", "Upper Siang", "Upper Subansiri", "West Kameng",
  ],
  Bihar: [
    "Araria", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Darbhanga", "Gaya", "Jamui",
    "Katihar", "Kishanganj", "Madhepura", "Madhubani", "Munger", "Nalanda", "Nawada",
    "Pashchim Champaran", "Patna", "Purbi Champaran", "Purnia", "Saharsa", "Saran",
    "Sitamarhi", "Siwan", "Supaul", "Vaishali",
  ],
  Haryana: ["Nuh"],
  Jharkhand: ["Sahebganj"],
  "Madhya Pradesh": [
    "Balaghat", "Barwani", "Bhind", "Damoh", "Gwalior", "Mandsaur", "Morena", "Panna",
    "Rajgarh", "Rewa", "Satna", "Sehore", "Shivpuri", "Singrauli", "Vidisha",
  ],
  Maharashtra: ["Mumbai", "Nashik", "Pune", "Thane"],
  Meghalaya: [
    "East Garo Hills", "East Khasi Hills", "North Garo Hills", "Ri Bhoi",
    "South West Khasi Hills", "West Jaintia Hills", "West Khasi Hills",
  ],
  Mizoram: ["Lawngtlai"],
  Nagaland: ["Mokokchung"],
  Rajasthan: [
    "Ajmer", "Alwar", "Barmer", "Bharatpur", "Bhilwara", "Bikaner", "Churu", "Jaipur",
    "Jaisalmer", "Jalore", "Jodhpur", "Nagaur", "Rajsamand", "Sawai Madhopur", "Sikar",
    "Udaipur",
  ],
  "Uttar Pradesh": [
    "Aligarh", "Ambedkar Nagar", "Amethi", "Amroha", "Azamgarh", "Baghpat", "Bahraich",
    "Ballia", "Balrampur", "Banda", "Bara Banki", "Bareilly", "Basti", "Bhadohi", "Bijnor",
    "Budaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah",
    "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur",
    "Gonda", "Gorakhpur", "Hamirpur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi",
    "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kheri", "Kushinagar",
    "Lucknow", "Mahrajganj", "Mathura", "Meerut", "Mirzapur", "Moradabad", "Pilibhit",
    "Prayagraj", "Rae Bareli", "Saharanpur", "Shahjahanpur", "Siddharthnagar", "Sitapur",
    "Sonbhadra", "Sultanpur", "Unnao", "Varanasi",
  ],
};

const BY_STATE_KEY = new Map<string, readonly string[]>(
  Object.entries(PRIORITY_DISTRICTS).map(([state, districts]) => [
    normalizeGeoName(state),
    districts,
  ]),
);

/** Normalized keys of the states that hold at least one priority district. */
export const PRIORITY_STATE_KEYS: ReadonlySet<string> = new Set(BY_STATE_KEY.keys());

/** Display names of the intervention states, alphabetical. */
export const PRIORITY_STATE_NAMES: readonly string[] = Object.keys(PRIORITY_DISTRICTS).sort((a, b) =>
  a.localeCompare(b),
);

/** How many districts the programme covers in total (143 at rollout). */
export const PRIORITY_DISTRICT_TOTAL = Object.values(PRIORITY_DISTRICTS).reduce(
  (sum, list) => sum + list.length,
  0,
);

export function isPriorityState(stateName: string | null | undefined): boolean {
  return PRIORITY_STATE_KEYS.has(normalizeGeoName(stateName));
}

/** The programme's district names for one state; empty for a non-intervention state. */
export function priorityDistrictNames(stateName: string | null | undefined): readonly string[] {
  return BY_STATE_KEY.get(normalizeGeoName(stateName)) ?? [];
}

// Direction words that distinguish otherwise-identical district names —
// "East Jaintia Hills" vs "West Jaintia Hills", "West Siang" vs "Siang". They
// sit within the fuzzy tolerance of each other, so a plain edit-distance match
// would fold a non-programme district into the priority set. Longest first so
// "southwest" wins over "south".
const QUALIFIERS = [
  "northeast", "northwest", "southeast", "southwest",
  "north", "south", "east", "west", "upper", "lower", "central", "greater",
];

/** The leading direction word of a normalized name, "" when it has none. */
function qualifierPrefix(norm: string): string {
  return QUALIFIERS.find((q) => norm.startsWith(q)) ?? "";
}

/**
 * `resolveOptionValue` with the direction guard applied: a fuzzy hit only
 * counts when both names carry the same leading direction word.
 */
function resolveGuarded(target: string, options: string[]): string | null {
  const hit = resolveOptionValue(target, options);
  if (!hit) return null;
  return qualifierPrefix(normalizeGeoName(target)) === qualifierPrefix(normalizeGeoName(hit))
    ? hit
    : null;
}

/**
 * The state's priority districts expressed in the *roster's* own spelling.
 *
 * Direction matters here. `resolveOptionValue`'s fuzzy tolerance scales with
 * the length of the name being resolved, and the boundary file carries
 * transliteration artefacts that are shorter than the plain name
 * ("Ch>Ngl>Ng" for Changlang, "East G>Ro Hills" for East Garo Hills). Resolving
 * the clean programme name against the roster clears the threshold; the reverse
 * does not. Use this whenever a full roster is available.
 */
export function priorityRoster(
  stateName: string | null | undefined,
  roster: string[],
): string[] {
  const names = priorityDistrictNames(stateName);
  if (names.length === 0) return [];
  const matched = new Set<string>();
  for (const name of names) {
    const hit = resolveGuarded(name, roster);
    if (hit) matched.add(hit);
  }
  return [...matched];
}

/**
 * Whether one district is a Gavi priority district. Tries both match
 * directions — the tolerance depends on which name is being resolved, and the
 * boundary file's shortened spellings only clear it one way round.
 */
export function isPriorityDistrict(
  stateName: string | null | undefined,
  districtName: string | null | undefined,
): boolean {
  const names = priorityDistrictNames(stateName);
  if (names.length === 0) return false;
  const candidate = (districtName ?? "").trim();
  const norm = normalizeGeoName(candidate);
  if (!norm) return false;
  if (names.some((n) => normalizeGeoName(n) === norm)) return true;
  if (resolveGuarded(candidate, names as string[]) !== null) return true;
  return names.some((n) => resolveGuarded(n, [candidate]) !== null);
}

/**
 * Scope test for a saved review. State-level reviews carry no district, so they
 * qualify on their state alone; district and block reviews must name a priority
 * district.
 */
export function inDistrictScope(
  scope: DistrictScope,
  stateName: string | null | undefined,
  districtName: string | null | undefined,
): boolean {
  if (scope === "ALL") return true;
  if (!isPriorityState(stateName)) return false;
  if (!(districtName ?? "").trim()) return true;
  return isPriorityDistrict(stateName, districtName);
}
