import { createHash } from "node:crypto";
import { Response } from "express";
import { z } from "zod";
import { db, FieldValue, storageBucket } from "../lib/firebase";
import type { AuthRequest, JwtUser } from "../middleware/auth.middleware";
import { canAccessPortal } from "../lib/portalAuthorization";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const scoreSchema = z.number().min(0).max(100);
const factPackSchema = z.object({
  schemaVersion: z.literal("1.0"),
  rulesVersion: z.string().trim().min(1).max(50),
  generatedFrom: z.literal("UWIN_STATE_COMPUTED_KPIS"),
  scope: z.record(z.string(), z.unknown()),
  scores: z.record(z.string(), z.unknown()),
  districtDistribution: z.record(z.string(), z.number().int().min(0)),
  districts: z.array(z.record(z.string(), z.unknown())).max(1000),
  findings: z.array(z.record(z.string(), z.unknown())).max(500),
  actionRules: z.array(z.record(z.string(), z.unknown())).max(500),
  positiveFindings: z.array(z.string().max(1000)).max(50),
  limitations: z.array(z.string().max(2000)).max(50),
});

const createReportSchema = z.object({
  state: z.string().trim().min(1).max(120),
  periodStart: monthSchema,
  periodEnd: monthSchema,
  sourceSignature: z.string().trim().min(1).max(1000),
  analysisMode: z.enum(["facility", "subcenter", "sessionsite"]),
  narrativeMode: z.enum(["DETERMINISTIC", "AI_ASSISTED"]).default("DETERMINISTIC"),
  filters: z.object({
    districts: z.array(z.string().trim().min(1)).max(200).default([]),
    blocks: z.array(z.string().trim().min(1)).max(5000).default([]),
    months: z.array(monthSchema).max(120).default([]),
    ownership: z.array(z.string().trim().min(1)).max(10).default([]),
    ru: z.array(z.string().trim().min(1)).max(10).default([]),
  }),
  scores: z.object({
    overall: scoreSchema,
    availability: scoreSchema,
    accuracy: scoreSchema,
    consistency: scoreSchema,
  }),
  counts: z.object({
    districts: z.number().int().min(0),
    blocks: z.number().int().min(0),
    facilities: z.number().int().min(0),
    // Optional keeps report creation compatible with clients released before
    // sub-center-wise analysis was available. Current clients always send it.
    subCenters: z.number().int().min(0).optional(),
    sessionSites: z.number().int().min(0),
    analysedUnits: z.number().int().min(0),
  }),
  reviewContext: z.object({
    designation: z.string().trim().max(200).nullable().optional(),
    purpose: z.string().trim().max(500).nullable().optional(),
    purposeDetail: z.string().trim().max(1000).nullable().optional(),
  }).optional(),
  factPack: factPackSchema,
  rulesVersion: z.string().trim().min(1).max(50).default("uwin-state-dqa-v1"),
  templateVersion: z.string().trim().min(1).max(50).default("uwin-state-report-v1"),
});

const normalizeGeo = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function canAccessState(user: JwtUser | undefined, state: unknown): boolean {
  if (!user || !canAccessPortal(user, "UWIN_STATE")) return false;
  if (user.role === "ADMIN" || user.level === "NATIONAL") return true;
  return user.level === "STATE" && normalizeGeo(user.geoState) === normalizeGeo(state);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function serializeReport(doc: FirebaseFirestore.DocumentSnapshot, includeDetails = true) {
  const data = doc.data()!;
  const { factPack, ...summary } = data;
  return {
    id: doc.id,
    ...summary,
    ...(includeDetails ? { factPack } : {}),
    hasFactPack: Boolean(factPack),
    pdfAvailable: Boolean(data.artifacts?.pdf?.storagePath || data.artifacts?.pdf?.artifactId),
    pdfFileName: data.artifacts?.pdf?.fileName ?? null,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    approvedAt: data.approvedAt?.toDate?.()?.toISOString() ?? null,
  };
}

export const createUwinStateReport = async (req: AuthRequest, res: Response) => {
  const parsed = createReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const input = parsed.data;
  if (input.periodStart > input.periodEnd) {
    res.status(400).json({ message: "Reporting period start must not be after the end" });
    return;
  }
  if (!canAccessState(req.user, input.state)) {
    res.status(403).json({ message: "You do not have access to U-WIN State reports for this state" });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(input.factPack), "utf8") > 500_000) {
    res.status(413).json({ message: "The report evidence pack is too large" });
    return;
  }

  const stateKey = normalizeGeo(input.state);
  const geographyPeriodKey = `${stateKey}|${input.periodStart}|${input.periodEnd}`;
  const seriesId = hash(geographyPeriodKey);
  const analysisFingerprint = hash({ portal: "UWIN_STATE", ...input });
  const reportRef = db.collection("uwinStateReports").doc(analysisFingerprint);
  const seriesRef = db.collection("uwinStateReportSeries").doc(seriesId);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reportRef);
      if (existing.exists) return { reused: true, id: reportRef.id };

      const series = await transaction.get(seriesRef);
      const version = Number(series.data()?.latestVersion ?? 0) + 1;
      const reportNumber = `UWIN-${input.periodStart.replace("-", "")}-${input.periodEnd.replace("-", "")}-V${version}`;

      transaction.set(reportRef, {
        portal: "UWIN_STATE",
        state: input.state,
        stateKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        geographyPeriodKey,
        analysisFingerprint,
        version,
        reportNumber,
        status: "SAVED",
        sourceSignature: input.sourceSignature,
        analysisMode: input.analysisMode,
        narrativeMode: input.narrativeMode,
        filters: input.filters,
        scores: input.scores,
        counts: input.counts,
        reviewContext: input.reviewContext ?? null,
        factPack: input.factPack,
        rulesVersion: input.rulesVersion,
        templateVersion: input.templateVersion,
        createdBy: {
          id: req.user!.id,
          email: req.user!.email,
          level: req.user!.level ?? null,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(seriesRef, {
        portal: "UWIN_STATE",
        state: input.state,
        stateKey,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        latestVersion: version,
        latestReportId: reportRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return { reused: false, id: reportRef.id };
    });

    const saved = await db.collection("uwinStateReports").doc(result.id).get();
    res.status(result.reused ? 200 : 201).json({ ...serializeReport(saved), reused: result.reused });
  } catch (error) {
    console.error("Create U-WIN State report error:", error);
    res.status(500).json({ message: "Failed to save U-WIN State report" });
  }
};

export const uploadUwinStateReportPdf = async (req: AuthRequest, res: Response) => {
  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (bytes.length === 0 || bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
    res.status(400).json({ message: "A valid PDF report is required" });
    return;
  }
  if (bytes.length > 750_000) {
    res.status(413).json({ message: "The three-page PDF exceeds the 750 KB storage limit" });
    return;
  }

  try {
    const reportRef = db.collection("uwinStateReports").doc(req.params.id as string);
    const report = await reportRef.get();
    const data = report.data();
    if (!report.exists || !canAccessState(req.user, data?.state)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    if (data?.createdBy?.id !== req.user!.id && req.user!.role !== "ADMIN") {
      res.status(403).json({ message: "Only the report creator or an administrator can save its PDF" });
      return;
    }
    if (!["DRAFT", "SAVED"].includes(data?.status)) {
      res.status(409).json({ message: "Only a saved report can receive a generated PDF" });
      return;
    }

    const pdfHash = createHash("sha256").update(bytes).digest("hex");
    const existing = data?.artifacts?.pdf;
    if (existing?.hash && existing.hash !== pdfHash) {
      res.status(409).json({ message: "This report version already has a different immutable PDF" });
      return;
    }
    if (existing?.hash === pdfHash) {
      res.json({ pdfAvailable: true, reused: true, fileName: existing.fileName });
      return;
    }

    const fileName = `${data?.reportNumber || report.id}.pdf`;
    const useCloudStorage = process.env.UWIN_STATE_REPORT_STORAGE === "GCS";
    let storageDescriptor: Record<string, unknown>;
    if (useCloudStorage) {
      const stateSegment = String(data?.stateKey || "state").replace(/[^a-z0-9]+/g, "-");
      const storagePath = `reports/uwin-state/${stateSegment}/${data?.periodStart}_${data?.periodEnd}/v${data?.version}/${report.id}.pdf`;
      await storageBucket.file(storagePath).save(bytes, {
        resumable: false,
        contentType: "application/pdf",
        metadata: {
          cacheControl: "private, max-age=0, no-store",
          metadata: { reportId: report.id, reportNumber: data?.reportNumber || "" },
        },
      });
      storageDescriptor = { storageBackend: "GCS", storagePath };
    } else {
      const artifactId = report.id;
      await db.collection("uwinStateReportArtifacts").doc(artifactId).set({
        reportId: report.id,
        contentType: "application/pdf",
        pdfBytes: bytes,
        hash: pdfHash,
        size: bytes.length,
        createdAt: FieldValue.serverTimestamp(),
      });
      storageDescriptor = { storageBackend: "FIRESTORE", artifactId };
    }
    await reportRef.update({
      "artifacts.pdf": {
        ...storageDescriptor,
        fileName,
        hash: pdfHash,
        size: bytes.length,
        createdAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ pdfAvailable: true, reused: false, fileName });
  } catch (error) {
    console.error("Upload U-WIN State report PDF error:", error);
    res.status(500).json({ message: "Failed to save report PDF" });
  }
};

export const downloadUwinStateReportPdf = async (req: AuthRequest, res: Response) => {
  try {
    const report = await db.collection("uwinStateReports").doc(req.params.id as string).get();
    const data = report.data();
    if (!report.exists || !canAccessState(req.user, data?.state)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const pdf = data?.artifacts?.pdf;
    if (!pdf?.storagePath && !pdf?.artifactId) {
      res.status(404).json({ message: "The PDF has not been generated for this report" });
      return;
    }
    let bytes: Buffer;
    if (pdf.storageBackend === "FIRESTORE" || pdf.artifactId) {
      const artifact = await db.collection("uwinStateReportArtifacts").doc(pdf.artifactId || report.id).get();
      const stored = artifact.data()?.pdfBytes;
      if (!artifact.exists || !stored) {
        res.status(404).json({ message: "The saved PDF artifact was not found" });
        return;
      }
      bytes = Buffer.isBuffer(stored)
        ? stored
        : typeof stored.toUint8Array === "function"
          ? Buffer.from(stored.toUint8Array())
          : Buffer.from(stored);
    } else {
      [bytes] = await storageBucket.file(pdf.storagePath).download();
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${String(pdf.fileName).replace(/["\r\n]/g, "")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(bytes);
  } catch (error) {
    console.error("Download U-WIN State report PDF error:", error);
    res.status(500).json({ message: "Failed to download report PDF" });
  }
};

export const listUwinStateReports = async (req: AuthRequest, res: Response) => {
  if (!canAccessPortal(req.user, "UWIN_STATE")) {
    res.status(403).json({ message: "You do not have access to U-WIN State reports" });
    return;
  }

  const requestedState = typeof req.query.state === "string" ? req.query.state : null;
  const periodStart = typeof req.query.periodStart === "string" ? req.query.periodStart : null;
  const periodEnd = typeof req.query.periodEnd === "string" ? req.query.periodEnd : null;

  try {
    const snapshot = await db.collection("uwinStateReports").orderBy("createdAt", "desc").limit(500).get();
    const reports = snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        if (!canAccessState(req.user, data.state)) return false;
        if (requestedState && normalizeGeo(data.state) !== normalizeGeo(requestedState)) return false;
        if (periodStart && data.periodStart !== periodStart) return false;
        if (periodEnd && data.periodEnd !== periodEnd) return false;
        return true;
      })
      .map((doc) => serializeReport(doc, false));
    res.json(reports);
  } catch (error) {
    console.error("List U-WIN State reports error:", error);
    res.status(500).json({ message: "Failed to load U-WIN State reports" });
  }
};

export const getUwinStateReport = async (req: AuthRequest, res: Response) => {
  try {
    const report = await db.collection("uwinStateReports").doc(req.params.id as string).get();
    if (!report.exists || !canAccessState(req.user, report.data()?.state)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    res.json(serializeReport(report));
  } catch (error) {
    console.error("Get U-WIN State report error:", error);
    res.status(500).json({ message: "Failed to load U-WIN State report" });
  }
};
