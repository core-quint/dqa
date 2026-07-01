import { Response } from "express";
import { z } from "zod";
import { adminAuth, db, FieldValue } from "../lib/firebase";
import { AuthRequest } from "../middleware/auth.middleware";

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "USER"]).optional().default("USER"),
});

export async function register(req: AuthRequest, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const { email, password, role } = parsed.data;

  try {
    const fbUser = await adminAuth.createUser({ email, password });

    await adminAuth.setCustomUserClaims(fbUser.uid, {
      role,
      level: "NATIONAL",
      geoState: null,
      geoDistrict: null,
      geoBlock: null,
    });

    await db.collection("users").doc(fbUser.uid).set({
      email,
      role,
      level: "NATIONAL",
      geoState: null,
      geoDistrict: null,
      geoBlock: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      message: "User created",
      user: { id: fbUser.uid, email, role, createdAt: new Date().toISOString() },
    });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "auth/email-already-exists") {
      res.status(409).json({ message: "User already exists" });
      return;
    }
    res.status(500).json({ message: "Registration failed" });
  }
}
