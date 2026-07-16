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
 * PCTS reports are district-level Rajasthan data, but they can be reviewed by
 * national users, Rajasthan state users, and the assigned Rajasthan district
 * user. Block users and users outside Rajasthan must not receive PCTS records.
 */
export function canAccessPcts(user: JwtUser | undefined): boolean {
  if (user?.role === "ADMIN") return true;
  if (!user || user.role !== "USER") return false;

  if (user.level === "NATIONAL") return true;
  if (user.level === "STATE") {
    return normalizeGeo(user.geoState) === "rajasthan";
  }
  if (user.level === "DISTRICT") {
    return (
      normalizeGeo(user.geoState) === "rajasthan" &&
      Boolean(normalizeGeo(user.geoDistrict))
    );
  }

  return false;
}

export function authorizePctsWrite(
  user: JwtUser | undefined,
  metadata: PctsWriteMetadata,
  options: PctsWriteAuthorizationOptions = {},
): PctsWriteAuthorization {
  // PCTS is always a district-level review, including when an administrator
  // creates the snapshot.
  if (options.requireDqaLevel && metadata.dqaLevel !== "DISTRICT") {
    return {
      authorized: false,
      message: "PCTS snapshots must use DISTRICT DQA level",
    };
  }

  const metadataState = normalizeGeo(metadata.state);
  const metadataDistrict = normalizeGeo(metadata.district);
  if (metadataState !== "rajasthan" || !metadataDistrict) {
    return {
      authorized: false,
      message: "PCTS writes require a Rajasthan state and district",
    };
  }

  if (user?.role === "ADMIN") return { authorized: true };

  if (!canAccessPcts(user)) {
    return {
      authorized: false,
      message:
        "PCTS access is limited to national users, Rajasthan state users, and assigned Rajasthan district users",
    };
  }

  if (
    user?.level === "DISTRICT" &&
    metadataDistrict !== normalizeGeo(user.geoDistrict)
  ) {
    return {
      authorized: false,
      message: "PCTS geography does not match the authenticated user scope",
    };
  }

  return { authorized: true };
}
