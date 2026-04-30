import { Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const snapshotSchema = z.object({
  state: z.string().min(1),
  district: z.string().min(1),
  duration: z.string().min(1),
  overallScore: z.number(),
  availabilityScore: z.number(),
  completenessScore: z.number().optional().default(0),
  accuracyScore: z.number(),
  consistencyScore: z.number(),
  portal: z.string().optional().default("HMIS"),
  dqaLevel: z.enum(["DISTRICT", "BLOCK"]).optional(),
  block: z.string().trim().min(1).optional().nullable(),
  periodStart: z.string().trim().min(1).optional().nullable(),
  periodEnd: z.string().trim().min(1).optional().nullable(),
});

export const createSnapshot = async (req: AuthRequest, res: Response) => {
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const {
    state,
    district,
    duration,
    overallScore,
    availabilityScore,
    completenessScore,
    accuracyScore,
    consistencyScore,
    portal,
    dqaLevel,
    block,
    periodStart,
    periodEnd,
  } = parsed.data;

  try {
    const snapshot = await prisma.dqaSnapshot.create({
      data: {
        state,
        district,
        reportingMonth: duration,
        overallScore,
        kpiData: {
          availabilityScore,
          completenessScore,
          accuracyScore,
          consistencyScore,
          dqaLevel,
          block: block ?? null,
          periodStart: periodStart ?? null,
          periodEnd: periodEnd ?? null,
        },
        portal,
        userId: req.user!.id,
      },
    });

    res.status(201).json(snapshot);
  } catch (error) {
    console.error("Snapshot error:", error);
    res.status(500).json({ message: "Failed to create snapshot" });
  }
};

export const getSnapshots = async (req: AuthRequest, res: Response) => {
  try {
    const visibilityWhere: Prisma.DqaSnapshotWhereInput = {};

    if (req.user?.role !== "ADMIN") {
      if (req.user?.level === "NATIONAL") {
        // National users can see all saved snapshots.
      } else if (req.user?.level === "STATE" && req.user.geoState) {
        visibilityWhere.state = {
          equals: req.user.geoState,
          mode: "insensitive",
        };
      } else if (
        (req.user?.level === "DISTRICT" || req.user?.level === "BLOCK") &&
        req.user.geoState &&
        req.user.geoDistrict
      ) {
        visibilityWhere.AND = [
          {
            state: {
              equals: req.user.geoState,
              mode: "insensitive",
            },
          },
          {
            district: {
              equals: req.user.geoDistrict,
              mode: "insensitive",
            },
          },
        ];
      } else {
        visibilityWhere.userId = req.user!.id;
      }
    }

    const snapshots = await prisma.dqaSnapshot.findMany({
      where: visibilityWhere,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            level: true,
            geoState: true,
            geoDistrict: true,
            geoBlock: true,
          },
        },
      },
    });

    res.json(
      snapshots.map(({ user, ...snapshot }) => ({
        ...snapshot,
        canDelete: snapshot.userId === req.user!.id,
        createdBy: user
          ? {
              id: user.id,
              email: user.email,
              level: user.level,
              geoState: user.geoState,
              geoDistrict: user.geoDistrict,
              geoBlock: user.geoBlock,
            }
          : null,
      })),
    );
  } catch (error) {
    console.error("Fetch snapshot error:", error);
    res.status(500).json({ message: "Failed to fetch snapshots" });
  }
};

export const deleteSnapshot = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    const snapshot = await prisma.dqaSnapshot.findUnique({ where: { id } });

    if (!snapshot || snapshot.userId !== req.user!.id) {
      res.status(404).json({ message: "Snapshot not found" });
      return;
    }

    await prisma.dqaSnapshot.delete({ where: { id } });
    res.json({ message: "Deleted" });
  } catch (error) {
    console.error("Delete snapshot error:", error);
    res.status(500).json({ message: "Failed to delete snapshot" });
  }
};
