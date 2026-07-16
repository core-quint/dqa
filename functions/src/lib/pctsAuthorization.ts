import type { JwtUser } from "../middleware/auth.middleware";

interface PctsWriteMetadata {
  state?: string | null;
  district?: string | null;
  dqaLevel?: "STATE" | "DISTRICT" | "BLOCK" | null;
}

interface PctsWriteAuthorizationOptions {
  requireDqaLevel?: boolean;
}

export type PctsWriteAuthorization =
  | { authorized: true }
  | { authorized: false; message: string };

const normalizeGeo = (value: string | null | undefined): string =>
  (value ?? "").trim().toLowerCase();

/**
 * PCTS is a Rajasthan district-only workflow. Admins retain cross-geography
 * access; every non-admin write must be bound to the geography in the caller's
 * verified Firebase token rather than trusting request-body metadata.
 */
export function authorizePctsWrite(
  user: JwtUser | undefined,
  metadata: PctsWriteMetadata,
  options: PctsWriteAuthorizationOptions = {},
): PctsWriteAuthorization {
  if (user?.role === "ADMIN") return { authorized: true };

  if (
    !user ||
    user.role !== "USER" ||
    user.level !== "DISTRICT" ||
    normalizeGeo(user.geoState) !== "rajasthan" ||
    !normalizeGeo(user.geoDistrict)
  ) {
    return {
      authorized: false,
      message: "PCTS writes require Rajasthan district-level access",
    };
  }

  if (
    normalizeGeo(metadata.state) !== normalizeGeo(user.geoState) ||
    normalizeGeo(metadata.district) !== normalizeGeo(user.geoDistrict)
  ) {
    return {
      authorized: false,
      message: "PCTS geography does not match the authenticated user scope",
    };
  }

  if (options.requireDqaLevel && metadata.dqaLevel !== "DISTRICT") {
    return {
      authorized: false,
      message: "PCTS snapshots must use DISTRICT DQA level",
    };
  }

  return { authorized: true };
}
