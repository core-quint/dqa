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

export function getPctsExpectedDistrict(
  auth: PctsAccessProfile | null | undefined,
): string | undefined {
  if (!auth || auth.role === "admin" || !isAssignedRajasthanDistrict(auth)) {
    return undefined;
  }
  return auth.geoDistrict!.trim();
}
