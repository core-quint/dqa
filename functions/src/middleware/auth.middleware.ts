import { Request, Response, NextFunction } from "express";
import { adminAuth } from "../lib/firebase";

export interface JwtUser {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
  level?: "NATIONAL" | "STATE" | "DISTRICT" | "BLOCK";
  geoState?: string | null;
  geoDistrict?: string | null;
  geoBlock?: string | null;
}

export interface AuthRequest extends Request {
  user?: JwtUser;
}

const USER_LEVELS: ReadonlySet<NonNullable<JwtUser["level"]>> = new Set([
  "NATIONAL",
  "STATE",
  "DISTRICT",
  "BLOCK",
]);

const parseUserLevel = (value: unknown): JwtUser["level"] =>
  typeof value === "string" &&
  USER_LEVELS.has(value as NonNullable<JwtUser["level"]>)
    ? (value as NonNullable<JwtUser["level"]>)
    : undefined;

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.user = {
      id: decoded.uid,
      email: decoded.email!,
      role: decoded.role === "ADMIN" ? "ADMIN" : "USER",
      level: parseUserLevel(decoded.level),
      geoState: (decoded.geoState as string) ?? null,
      geoDistrict: (decoded.geoDistrict as string) ?? null,
      geoBlock: (decoded.geoBlock as string) ?? null,
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}
