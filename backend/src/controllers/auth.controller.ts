import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword, comparePassword } from "../utils/hash";
import { generateToken } from "../utils/jwt";

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "USER"]).optional().default("USER"),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function register(req: Request, res: Response) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const { email, password, role } = parsed.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ message: "User already exists" });
      return;
    }

    const hashed = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, password: hashed, role },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    res.status(201).json({ message: "User created", user });
  } catch {
    res.status(500).json({ message: "Registration failed" });
  }
}

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Cast needed until `prisma generate` is run after schema migration
    const user = await (prisma.user.findUnique({
      where: { email },
    }) as Promise<{
      id: string;
      email: string;
      password: string;
      role: "ADMIN" | "USER";
      level: "NATIONAL" | "STATE" | "DISTRICT" | "BLOCK";
      geoState: string | null;
      geoDistrict: string | null;
      geoBlock: string | null;
    } | null>);
    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      level: user.level,
      geoState: user.geoState,
      geoDistrict: user.geoDistrict,
      geoBlock: user.geoBlock,
    });

    res.json({ token });
  } catch {
    res.status(500).json({ message: "Login failed" });
  }
}
