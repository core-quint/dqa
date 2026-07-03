import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import type { CollectionReference, Query } from "firebase-admin/firestore";
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
  blockCount: z.number().optional().nullable(),
  facilityCount: z.number().optional().nullable(),
  sessionSiteCount: z.number().optional().nullable(),
});

export const createSnapshot = async (req: AuthRequest, res: Response) => {
  const parsed = snapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const {
    state, district, duration, overallScore,
    availabilityScore, completenessScore, accuracyScore, consistencyScore,
    portal, dqaLevel, block, periodStart, periodEnd,
    blockCount, facilityCount, sessionSiteCount,
  } = parsed.data;

  try {
    const docRef = db.collection("snapshots").doc();
    await docRef.set({
      state,
      district,
      reportingMonth: duration,
      overallScore,
      kpiData: {
        availabilityScore,
        completenessScore,
        accuracyScore,
        consistencyScore,
        dqaLevel: dqaLevel ?? null,
        block: block ?? null,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        blockCount: blockCount ?? null,
        facilityCount: facilityCount ?? null,
        sessionSiteCount: sessionSiteCount ?? null,
      },
      portal,
      userId: req.user!.id,
      createdAt: FieldValue.serverTimestamp(),
    });

    const doc = await docRef.get();
    const data = doc.data()!;
    res.status(201).json({
      id: docRef.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("Snapshot error:", error);
    res.status(500).json({ message: "Failed to create snapshot" });
  }
};

export const getSnapshots = async (req: AuthRequest, res: Response) => {
  try {
    const col = db.collection("snapshots") as CollectionReference;
    let query: Query = col.orderBy("createdAt", "desc");

    if (req.user?.role !== "ADMIN") {
      if (req.user?.level === "NATIONAL") {
        // National users see all snapshots — no extra filter
      } else if (req.user?.level === "STATE" && req.user.geoState) {
        query = col
          .where("state", "==", req.user.geoState)
          .orderBy("createdAt", "desc");
      } else if (
        (req.user?.level === "DISTRICT" || req.user?.level === "BLOCK") &&
        req.user.geoState &&
        req.user.geoDistrict
      ) {
        query = col
          .where("state", "==", req.user.geoState)
          .where("district", "==", req.user.geoDistrict)
          .orderBy("createdAt", "desc");
      } else {
        query = col
          .where("userId", "==", req.user!.id)
          .orderBy("createdAt", "desc");
      }
    }

    const snap = await query.get();
    const snapshots = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        canDelete: data.userId === req.user!.id,
      };
    });

    res.json(snapshots);
  } catch (error) {
    console.error("Fetch snapshot error:", error);
    res.status(500).json({ message: "Failed to fetch snapshots" });
  }
};

export const deleteSnapshot = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    const docRef = db.collection("snapshots").doc(id);
    const doc = await docRef.get();

    if (!doc.exists || doc.data()?.userId !== req.user!.id) {
      res.status(404).json({ message: "Snapshot not found" });
      return;
    }

    await docRef.delete();
    res.json({ message: "Deleted" });
  } catch (error) {
    console.error("Delete snapshot error:", error);
    res.status(500).json({ message: "Failed to delete snapshot" });
  }
};
