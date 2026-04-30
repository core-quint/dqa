import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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

export function authenticate(
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}
