import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import type { CollectionReference, Query } from "firebase-admin/firestore";
import { AuthRequest } from "../middleware/auth.middleware";
import { authorizePctsWrite } from "../lib/pctsAuthorization";
import { canAccessPortal, normalizePortal } from "../lib/portalAuthorization";
import { breakdownSchema } from "../lib/snapshotBreakdownSchema";

// Scoring method v2 (2026-09-22): a component that could not be scored is sent
// as null (N/A), never as a made-up 0 or 100.
const componentScore = z.number().min(0).max(100).nullable();
const scopeList = z.array(z.string().trim().min(1).max(200)).max(1000);
const isoDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const snapshotScopeSchema = z.object({
  blocks: scopeList.default([]),
  districts: scopeList.default([]),
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(120).default([]),
  ownership: scopeList.default([]),
  ruralUrban: scopeList.default([]),
  facilityTypes: scopeList.default([]),
  analysisMode: z.string().trim().max(40).nullable().optional(),
  partial: z.boolean().default(false),
});

const snapshotSchema = z.object({
  state: z.string().min(1),
  district: z.string().min(1),
  duration: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  availabilityScore: componentScore,
  completenessScore: componentScore.optional(),
  accuracyScore: componentScore,
  consistencyScore: componentScore,
  methodVersion: z.number().int().min(1).max(100).optional().nullable(),
  scoredComponents: z.number().int().min(0).max(10).optional().nullable(),
  scope: snapshotScopeSchema.optional().nullable(),
  uploadBlockCount: z.number().optional().nullable(),
  uploadFacilityCount: z.number().optional().nullable(),
  uploadSessionSiteCount: z.number().optional().nullable(),
  portal: z.string().optional().default("HMIS"),
  dqaLevel: z.enum(["STATE", "DISTRICT", "BLOCK"]).optional(),
  block: z.string().trim().min(1).optional().nullable(),
  periodStart: z.string().trim().min(1).optional().nullable(),
  periodEnd: z.string().trim().min(1).optional().nullable(),
  // Exact first / last day of data the uploader declared (U-WIN), kept beside the
  // month-grain periodStart/periodEnd that trends and the dashboard run on.
  dataFrom: isoDay.optional().nullable(),
  dataTo: isoDay.optional().nullable(),
  uploadDuration: z.enum(["WEEKLY", "MONTHLY"]).optional().nullable(),
  blockCount: z.number().optional().nullable(),
  facilityCount: z.number().optional().nullable(),
  sessionSiteCount: z.number().optional().nullable(),
  districtCount: z.number().optional().nullable(),
  analysisGranularity: z.enum(["DISTRICT", "BLOCK"]).optional().nullable(),
  designation: z.string().trim().optional().nullable(),
  // Pre-upload "Purpose of DQA" — like designation, the frontend sends '' when
  // unset, so these must accept empty strings (normalized to null on write).
  purpose: z.string().trim().optional().nullable(),
  purposeDetail: z.string().trim().optional().nullable(),
  // Score grid for the complete upload; validated on its own below so a bad grid
  // can never block saving the review itself.
  breakdown: z.unknown().optional().nullable(),
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
    portal, dqaLevel, block, periodStart, periodEnd, dataFrom, dataTo, uploadDuration,
    blockCount, facilityCount, sessionSiteCount, districtCount, analysisGranularity, designation,
    purpose, purposeDetail,
    methodVersion, scoredComponents, scope,
    uploadBlockCount, uploadFacilityCount, uploadSessionSiteCount,
  } = parsed.data;

  let breakdown: z.infer<typeof breakdownSchema> | null = null;
  if (parsed.data.breakdown !== undefined && parsed.data.breakdown !== null) {
    const grid = breakdownSchema.safeParse(parsed.data.breakdown);
    if (grid.success) breakdown = grid.data;
    else console.warn("Snapshot score grid rejected:", grid.error.issues[0]);
  }

  const normalizedPortal = normalizePortal(portal);

  if (!canAccessPortal(req.user, normalizedPortal)) {
    res.status(403).json({ message: "You do not have access to this portal" });
    return;
  }

  if (normalizedPortal === "PCTS") {
    const authorization = authorizePctsWrite(
      req.user,
      { state, district, dqaLevel },
      { requireDqaLevel: true },
    );
    if (!authorization.authorized) {
      res.status(403).json({ message: authorization.message });
      return;
    }
  }

  try {
    const docRef = db.collection("snapshots").doc();
    const batch = db.batch();
    batch.set(docRef, {
      state,
      district,
      reportingMonth: duration,
      overallScore,
      kpiData: {
        availabilityScore,
        completenessScore: completenessScore ?? null,
        accuracyScore,
        consistencyScore,
        // Absent on reviews saved before 2026-09-22 (method v1): those scores are
        // not comparable with v2 ones and are kept out of trends and averages.
        methodVersion: methodVersion ?? null,
        scoredComponents: scoredComponents ?? null,
        scope: scope ?? null,
        uploadBlockCount: uploadBlockCount ?? null,
        uploadFacilityCount: uploadFacilityCount ?? null,
        uploadSessionSiteCount: uploadSessionSiteCount ?? null,
        dqaLevel: dqaLevel ?? null,
        block: block ?? null,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        dataFrom: dataFrom ?? null,
        dataTo: dataTo ?? null,
        uploadDuration: uploadDuration ?? null,
        blockCount: blockCount ?? null,
        facilityCount: facilityCount ?? null,
        sessionSiteCount: sessionSiteCount ?? null,
        districtCount: districtCount ?? null,
        analysisGranularity: analysisGranularity ?? null,
        designation: designation ?? null,
        purpose: purpose?.trim() || null,
        purposeDetail: purposeDetail?.trim() || null,
        hasBreakdown: breakdown !== null,
      },
      portal: normalizedPortal,
      userId: req.user!.id,
      // Denormalized at write time so the Trend History "Saved by" column doesn't
      // need a per-row user lookup — previously never written at all, so every
      // snapshot showed a blank "Saved by".
      createdBy: {
        id: req.user!.id,
        email: req.user!.email,
        level: req.user!.level ?? null,
        geoState: req.user!.geoState ?? null,
        geoDistrict: req.user!.geoDistrict ?? null,
        geoBlock: req.user!.geoBlock ?? null,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    if (breakdown) {
      batch.set(db.collection("snapshotBreakdowns").doc(docRef.id), {
        ...breakdown,
        snapshotId: docRef.id,
        portal: normalizedPortal,
        state,
        district,
        userId: req.user!.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

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

// State/district names come from whatever the source CSV export used (e.g. U-WIN
// exports often use ALL CAPS state names, HMIS exports use Title Case) while a
// user's geoState/geoDistrict claim is set once in Title Case by an admin. An exact
// Firestore `.where("state", "==", ...)` match silently hides every snapshot whose
// casing doesn't happen to line up — normalize before comparing instead.
const normalizeGeo = (s: unknown): string =>
  typeof s === "string" ? s.trim().toLowerCase() : "";

export const getSnapshots = async (req: AuthRequest, res: Response) => {
  try {
    const col = db.collection("snapshots") as CollectionReference;
    let query: Query = col.orderBy("createdAt", "desc");
    let geoFilter: ((data: FirebaseFirestore.DocumentData) => boolean) | null = null;

    if (req.user?.role !== "ADMIN") {
      if (req.user?.level === "NATIONAL") {
        // National users see all snapshots — no extra filter
      } else if (req.user?.level === "STATE" && req.user.geoState) {
        const targetState = normalizeGeo(req.user.geoState);
        geoFilter = (data) => normalizeGeo(data.state) === targetState;
      } else if (
        (req.user?.level === "DISTRICT" || req.user?.level === "BLOCK") &&
        req.user.geoState &&
        req.user.geoDistrict
      ) {
        const targetState = normalizeGeo(req.user.geoState);
        const targetDistrict = normalizeGeo(req.user.geoDistrict);
        geoFilter = (data) =>
          normalizeGeo(data.state) === targetState && normalizeGeo(data.district) === targetDistrict;
      } else {
        query = col
          .where("userId", "==", req.user!.id)
          .orderBy("createdAt", "desc");
      }
    }

    const snap = await query.get();
    const snapshots = snap.docs
      .filter((d) => {
        const data = d.data();
        if (!canAccessPortal(req.user, data.portal)) return false;
        return !geoFilter || geoFilter(data);
      })
      .map((d) => {
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

/** Whether this user may read a snapshot: the same rules as the snapshot list. */
function canReadSnapshot(user: AuthRequest["user"], data: FirebaseFirestore.DocumentData): boolean {
  if (!canAccessPortal(user, data.portal)) return false;
  if (user?.role === "ADMIN" || user?.level === "NATIONAL") return true;
  if (user?.level === "STATE" && user.geoState) {
    return normalizeGeo(data.state) === normalizeGeo(user.geoState);
  }
  if ((user?.level === "DISTRICT" || user?.level === "BLOCK") && user.geoState && user.geoDistrict) {
    return normalizeGeo(data.state) === normalizeGeo(user.geoState)
      && normalizeGeo(data.district) === normalizeGeo(user.geoDistrict);
  }
  return data.userId === user?.id;
}

/** The score grid of one saved review; `breakdown: null` when it was saved without one. */
export const getSnapshotBreakdown = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  try {
    const snapshot = await db.collection("snapshots").doc(id).get();
    if (!snapshot.exists || !canReadSnapshot(req.user, snapshot.data()!)) {
      res.status(404).json({ message: "Snapshot not found" });
      return;
    }
    const grid = await db.collection("snapshotBreakdowns").doc(id).get();
    if (!grid.exists) {
      res.json({ breakdown: null });
      return;
    }
    const {
      snapshotId: _snapshotId, portal: _portal, state: _state, district: _district,
      userId: _userId, createdAt: _createdAt, ...breakdown
    } = grid.data()!;
    res.json({ breakdown });
  } catch (error) {
    console.error("Fetch snapshot breakdown error:", error);
    res.status(500).json({ message: "Failed to fetch the score grid" });
  }
};

const MAX_BULK_BREAKDOWNS = 300;

/**
 * Score grids of many saved reviews at once (`?ids=a,b,c`, at most 300), for the
 * Dashboard and the Coverage map. Reviews the user may not read, and reviews saved
 * without a grid, are simply absent from the result.
 */
export const getSnapshotBreakdowns = async (req: AuthRequest, res: Response) => {
  const raw = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)))];
  if (ids.length > MAX_BULK_BREAKDOWNS) {
    res.status(400).json({ message: `Ask for at most ${MAX_BULK_BREAKDOWNS} score grids at a time.` });
    return;
  }
  if (ids.length === 0) {
    res.json({ breakdowns: {} });
    return;
  }
  try {
    const snapshots = await db.getAll(...ids.map((id) => db.collection("snapshots").doc(id)));
    const readable = snapshots
      .filter((doc) => doc.exists && canReadSnapshot(req.user, doc.data()!))
      .map((doc) => doc.id);
    const grids = readable.length > 0
      ? await db.getAll(...readable.map((id) => db.collection("snapshotBreakdowns").doc(id)))
      : [];
    const breakdowns: Record<string, unknown> = {};
    for (const grid of grids) {
      if (!grid.exists) continue;
      const {
        snapshotId: _snapshotId, portal: _portal, state: _state, district: _district,
        userId: _userId, createdAt: _createdAt, ...breakdown
      } = grid.data()!;
      breakdowns[grid.id] = breakdown;
    }
    res.json({ breakdowns });
  } catch (error) {
    console.error("Fetch snapshot breakdowns error:", error);
    res.status(500).json({ message: "Failed to fetch score grids" });
  }
};

export const deleteSnapshot = async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  try {
    const docRef = db.collection("snapshots").doc(id);
    const doc = await docRef.get();
    const data = doc.data();

    if (
      !doc.exists ||
      data?.userId !== req.user!.id ||
      !canAccessPortal(req.user, data?.portal)
    ) {
      res.status(404).json({ message: "Snapshot not found" });
      return;
    }

    const batch = db.batch();
    batch.delete(docRef);
    batch.delete(db.collection("snapshotBreakdowns").doc(id));
    await batch.commit();
    res.json({ message: "Deleted" });
  } catch (error) {
    console.error("Delete snapshot error:", error);
    res.status(500).json({ message: "Failed to delete snapshot" });
  }
};
