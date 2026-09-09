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

const bulkCreateSchema = z.object({
  users: z
    .array(createUserSchema)
    .min(1, "No users provided")
    .max(50, "Maximum 50 users per request"),
});

type NewUserData = z.infer<typeof createUserSchema>;

async function createSingleUser(data: NewUserData) {
  const { email, password, level, geoState, geoDistrict, geoBlock } = data;

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
    ...claims,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { id: fbUser.uid, email, ...claims };
}

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

  try {
    const created = await createSingleUser(parsed.data);
    res.status(201).json(created);
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

export const bulkCreateUsers = async (req: AuthRequest, res: Response) => {
  const parsed = bulkCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const results: { email: string; status: "created" | "failed"; message?: string }[] = [];
  for (const user of parsed.data.users) {
    try {
      await createSingleUser(user);
      results.push({ email: user.email, status: "created" });
    } catch (error: unknown) {
      console.error(`bulkCreateUsers error for ${user.email}:`, error);
      const message =
        (error as { code?: string }).code === "auth/email-already-exists"
          ? "User already exists"
          : error instanceof Error
            ? error.message
            : String(error);
      results.push({ email: user.email, status: "failed", message });
    }
  }

  const created = results.filter((r) => r.status === "created").length;
  res.status(201).json({ results, created, failed: results.length - created });
};

const updateUserSchema = createUserSchema.omit({ password: true }).superRefine((data, ctx) => {
  for (const field of [
    ...(data.level !== "NATIONAL" ? ["geoState" as const] : []),
    ...(["DISTRICT", "BLOCK"].includes(data.level) ? ["geoDistrict" as const] : []),
    ...(data.level === "BLOCK" ? ["geoBlock" as const] : []),
  ]) {
    if (!data[field]?.trim()) ctx.addIssue({ code: "custom", path: [field], message: `${field} is required for this level` });
  }
});

function userActionError(res: Response, error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === "auth/email-already-exists") return res.status(409).json({ message: "User ID (email) is already in use." });
  if (code === "auth/user-not-found") return res.status(404).json({ message: "User not found." });
  if (code === "auth/invalid-password" || code === "auth/invalid-email") return res.status(400).json({ message: "Invalid email or password." });
  return res.status(500).json({ message: "Unable to update user. Please try again." });
}

export const updateUser = async (req: AuthRequest, res: Response) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }
  const id = req.params.id as string;
  try {
    const ref = db.collection("users").doc(id);
    const existing = await ref.get();
    if (!existing.exists) { res.status(404).json({ message: "User not found." }); return; }
    const original = await adminAuth.getUser(id);
    const { email, level } = parsed.data;
    const scope = {
      level,
      geoState: level !== "NATIONAL" ? parsed.data.geoState!.trim() : null,
      geoDistrict: ["DISTRICT", "BLOCK"].includes(level) ? parsed.data.geoDistrict!.trim() : null,
      geoBlock: level === "BLOCK" ? parsed.data.geoBlock!.trim() : null,
    };
    await adminAuth.updateUser(id, { email });
    try {
      await adminAuth.setCustomUserClaims(id, { ...original.customClaims, ...scope });
      await ref.update({ email, ...scope });
    } catch (error) {
      await adminAuth.updateUser(id, { email: original.email });
      await adminAuth.setCustomUserClaims(id, original.customClaims ?? {});
      throw error;
    }
    res.json({ message: "User updated." });
  } catch (error) { userActionError(res, error); }
};

export const resetUserPassword = async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ password: z.string().min(8, "Password must be at least 8 characters") }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }
  try {
    await adminAuth.updateUser(req.params.id as string, { password: parsed.data.password });
    res.json({ message: "Password reset successfully." });
  } catch (error) { userActionError(res, error); }
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
