import { Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../utils/hash";
import { AuthRequest } from "../middleware/auth.middleware";

const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  level: z.enum(["NATIONAL", "STATE", "DISTRICT", "BLOCK"]).default("NATIONAL"),
  geoState: z.string().optional(),
  geoDistrict: z.string().optional(),
  geoBlock: z.string().optional(),
});

export const listUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, level: true, geoState: true, geoDistrict: true, geoBlock: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
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
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, password: hashed, role: "USER", level, geoState, geoDistrict, geoBlock },
      select: { id: true, email: true, role: true, level: true, geoState: true, geoDistrict: true, geoBlock: true },
    });

    res.status(201).json(user);
  } catch {
    res.status(500).json({ message: "Failed to create user" });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  if (id === req.user!.id) {
    res.status(400).json({ message: "Cannot delete yourself" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await prisma.user.delete({ where: { id } });
    res.json({ message: "User deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete user" });
  }
};

// Geo Dataset
export const uploadGeoDataset = async (req: AuthRequest, res: Response) => {
  const { entries } = req.body as { entries: { state: string; district: string; block: string }[] };

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ message: "No entries provided" });
    return;
  }

  try {
    // Clear existing and replace
    await prisma.geoEntry.deleteMany();
    await prisma.geoEntry.createMany({
      data: entries.map((e) => ({
        id: crypto.randomUUID(),
        state: e.state.trim(),
        district: e.district.trim(),
        block: e.block.trim(),
      })),
      skipDuplicates: true,
    });

    res.json({ message: `Imported ${entries.length} geo entries` });
  } catch {
    res.status(500).json({ message: "Failed to upload geodataset" });
  }
};

export const getGeoData = async (_req: AuthRequest, res: Response) => {
  try {
    const entries = await prisma.geoEntry.findMany({
      orderBy: [{ state: "asc" }, { district: "asc" }, { block: "asc" }],
    });
    res.json(entries);
  } catch {
    res.status(500).json({ message: "Failed to fetch geo data" });
  }
};
