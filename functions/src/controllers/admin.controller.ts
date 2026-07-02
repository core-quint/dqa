import { Response } from "express";
import { z } from "zod";
import { adminAuth, db, FieldValue } from "../lib/firebase";
import { AuthRequest } from "../middleware/auth.middleware";

const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  level: z.enum(["NATIONAL", "STATE", "DISTRICT", "BLOCK"]).default("NATIONAL"),
  geoState: z.string().optional(),
  geoDistrict: z.string().optional(),
  geoBlock: z.string().optional(),
});

export const listUsers = async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await db.collection("users").get();
    const users = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: (d.data().createdAt as FirebaseFirestore.Timestamp)?.toDate?.()?.toISOString() ?? null,
      }))
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    res.json(users);
  } catch {
    res.status(500).json({ message: "Failed to list users" });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const { email, password, level, geoState, geoDistrict, geoBlock } = parsed.data;

  try {
    const fbUser = await adminAuth.createUser({ email, password });

    const claims = {
      role: "USER",
      level,
      geoState: geoState ?? null,
      geoDistrict: geoDistrict ?? null,
      geoBlock: geoBlock ?? null,
    };

    await adminAuth.setCustomUserClaims(fbUser.uid, claims);

    await db.collection("users").doc(fbUser.uid).set({
      email,
      role: "USER",
      level,
      geoState: geoState ?? null,
      geoDistrict: geoDistrict ?? null,
      geoBlock: geoBlock ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json({
      id: fbUser.uid,
      email,
      role: "USER",
      level,
      geoState: geoState ?? null,
      geoDistrict: geoDistrict ?? null,
      geoBlock: geoBlock ?? null,
    });
  } catch (error: unknown) {
    console.error("createUser error:", error);
    if ((error as { code?: string }).code === "auth/email-already-exists") {
      res.status(409).json({ message: "User already exists" });
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ message: `Failed to create user: ${detail}` });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  if (id === req.user!.id) {
    res.status(400).json({ message: "Cannot delete yourself" });
    return;
  }

  try {
    await adminAuth.deleteUser(id);
    await db.collection("users").doc(id).delete();
    res.json({ message: "User deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete user" });
  }
};

export const uploadGeoDataset = async (req: AuthRequest, res: Response) => {
  const { entries } = req.body as { entries: { state: string; district: string; block: string }[] };

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ message: "No entries provided" });
    return;
  }

  try {
    const existing = await db.collection("geoEntries").get();
    for (const ch of chunk(existing.docs, 500)) {
      const batch = db.batch();
      ch.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    for (const ch of chunk(entries, 500)) {
      const batch = db.batch();
      ch.forEach((e) => {
        const id = [e.state.trim(), e.district.trim(), e.block.trim()]
          .join("_")
          .replace(/\//g, "-")
          .slice(0, 1500);
        const ref = db.collection("geoEntries").doc(id);
        batch.set(ref, {
          state: e.state.trim(),
          district: e.district.trim(),
          block: e.block.trim(),
        });
      });
      await batch.commit();
    }

    res.json({ message: `Imported ${entries.length} geo entries` });
  } catch (error) {
    console.error("Geo upload error:", error);
    const detail = error instanceof Error ? error.message : String(error);
    res.status(500).json({ message: `Failed to upload geodataset: ${detail}` });
  }
};

export const getGeoData = async (_req: AuthRequest, res: Response) => {
  try {
    const snap = await db.collection("geoEntries").get();
    const entries = (snap.docs.map((d) => ({ id: d.id, ...d.data() })) as {
      id: string;
      state: string;
      district: string;
      block: string;
    }[]).sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        a.district.localeCompare(b.district) ||
        a.block.localeCompare(b.block),
    );
    res.json(entries);
  } catch {
    res.status(500).json({ message: "Failed to fetch geo data" });
  }
};

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}
