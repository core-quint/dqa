import type { AuthState } from "../../components/dqa/LoginPage";

type PctsAccessProfile = Pick<
  AuthState,
  "role" | "level" | "geoState" | "geoDistrict"
>;

const normalizeGeo = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

export function isAssignedRajasthanDistrict(
  auth: PctsAccessProfile | null | undefined,
): boolean {
  return Boolean(
    auth &&
      auth.level === "DISTRICT" &&
      normalizeGeo(auth.geoState) === "rajasthan" &&
      auth.geoDistrict?.trim(),
  );
}

export function canUsePcts(
  auth: PctsAccessProfile | null | undefined,
): boolean {
  if (!auth) return false;
  if (auth.role === "admin") return true;
  if (auth.level === "NATIONAL") return true;
  if (auth.level === "STATE") {
    return normalizeGeo(auth.geoState) === "rajasthan";
  }
  return isAssignedRajasthanDistrict(auth);
}

/**
 * Rajasthan replaces the standard facility-level HMIS workflow with PCTS for
 * state and district users. National users and administrators retain HMIS,
 * while block users and users assigned outside Rajasthan are unchanged.
 * HMIS State is a separate workflow and is intentionally not covered here.
 */
export function canUseHmis(
  auth: PctsAccessProfile | null | undefined,
): boolean {
  if (!auth) return false;
  if (auth.role === "admin" || auth.level === "NATIONAL") return true;

  return !(
    normalizeGeo(auth.geoState) === "rajasthan" &&
    (auth.level === "STATE" || auth.level === "DISTRICT")
  );
}

export function getPctsExpectedDistrict(
  auth: PctsAccessProfile | null | undefined,
): string | undefined {
  if (!auth || auth.role === "admin" || !isAssignedRajasthanDistrict(auth)) {
    return undefined;
  }
  return auth.geoDistrict!.trim();
}
