import type { JwtUser } from "../middleware/auth.middleware";
import { canAccessPcts } from "./pctsAuthorization";

export type NormalizedPortal = "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";

const normalizeGeo = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/**
 * Snapshot records created before portal metadata was introduced have no portal
 * value. The frontend treats those records (and any unrecognized value) as
 * standard HMIS, so the API must use the same fail-closed normalization.
 */
export function normalizePortal(value: unknown): NormalizedPortal {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "UWIN") return "UWIN";
  if (normalized === "UWIN_STATE") return "UWIN_STATE";
  if (normalized === "HMIS_STATE") return "HMIS_STATE";
  if (normalized === "PCTS") return "PCTS";
  return "HMIS";
}

/**
 * Rajasthan state and district users use PCTS in place of standard HMIS.
 * This restriction intentionally does not apply to administrators, national
 * users, Rajasthan block users, or users assigned outside Rajasthan.
 */
export function canAccessStandardHmis(user: JwtUser | undefined): boolean {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (user.role !== "USER" || !user.level) return false;

  const isRajasthanStateOrDistrict =
    normalizeGeo(user.geoState) === "rajasthan" &&
    (user.level === "STATE" || user.level === "DISTRICT");

  return !isRajasthanStateOrDistrict;
}

export function canAccessPortal(
  user: JwtUser | undefined,
  portal: unknown,
): boolean {
  const normalizedPortal = normalizePortal(portal);
  if (normalizedPortal === "HMIS") return canAccessStandardHmis(user);
  if (normalizedPortal === "PCTS") return canAccessPcts(user);
  if (normalizedPortal === "UWIN_STATE") {
    return user?.role === "ADMIN" || user?.level === "NATIONAL" || user?.level === "STATE";
  }
  return Boolean(user);
}
