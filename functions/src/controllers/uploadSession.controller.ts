import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import { AuthRequest } from "../middleware/auth.middleware";
import { authorizePctsWrite } from "../lib/pctsAuthorization";
import { canAccessPortal } from "../lib/portalAuthorization";

const uploadSessionSchema = z.object({
  portal: z.enum(["HMIS", "UWIN", "UWIN_STATE", "HMIS_STATE", "PCTS"]),
  designation: z.string().min(1),
  purpose: z.string().min(1),
  // The frontend always sends these two as strings (defaulting to '' when not
  // applicable to the chosen Purpose) rather than omitting them — so this must
  // accept an empty string, not just "absent". A stray `.min(1)` here previously
  // rejected every single request (one of the two is always '').
  purposeSubOption: z.string().trim().optional().nullable(),
  purposeOtherText: z.string().trim().optional().nullable(),
  gpsLat: z.number().optional().nullable(),
  gpsLng: z.number().optional().nullable(),
  gpsAddress: z.string().trim().optional().nullable(),
  // Dataset context, known once the CSV has parsed (the log fires post-parse).
  // Makes this audit log analytically useful (who reviewed what, where) at zero
  // extra cost — same single write. All optional so older callers keep working.
  state: z.string().trim().optional().nullable(),
  district: z.string().trim().optional().nullable(),
  periodStart: z.string().trim().optional().nullable(),
  periodEnd: z.string().trim().optional().nullable(),
  blockCount: z.number().optional().nullable(),
  facilityCount: z.number().optional().nullable(),
  sessionSiteCount: z.number().optional().nullable(),
  districtCount: z.number().optional().nullable(),
  analysisGranularity: z.enum(["DISTRICT", "BLOCK"]).optional().nullable(),
});

export const createUploadSession = async (req: AuthRequest, res: Response) => {
  const parsed = uploadSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const {
    portal, designation, purpose, purposeSubOption, purposeOtherText, gpsLat, gpsLng, gpsAddress,
    state, district, periodStart, periodEnd, blockCount, facilityCount, sessionSiteCount, districtCount,
    analysisGranularity,
  } = parsed.data;

  if (!canAccessPortal(req.user, portal)) {
    res.status(403).json({ message: "You do not have access to this portal" });
    return;
  }

  if (portal === "PCTS") {
    const authorization = authorizePctsWrite(req.user, { state, district });
    if (!authorization.authorized) {
      res.status(403).json({ message: authorization.message });
      return;
    }
  }

  try {
    const docRef = db.collection("uploadSessions").doc();
    await docRef.set({
      portal,
      designation,
      purpose,
      purposeSubOption: purposeSubOption?.trim() || null,
      purposeOtherText: purposeOtherText?.trim() || null,
      gpsLat: gpsLat ?? null,
      gpsLng: gpsLng ?? null,
      gpsAddress: gpsAddress?.trim() || null,
      state: state?.trim() || null,
      district: district?.trim() || null,
      periodStart: periodStart?.trim() || null,
      periodEnd: periodEnd?.trim() || null,
      blockCount: blockCount ?? null,
      facilityCount: facilityCount ?? null,
      sessionSiteCount: sessionSiteCount ?? null,
      districtCount: districtCount ?? null,
      analysisGranularity: analysisGranularity ?? null,
      userId: req.user!.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error("Upload session error:", error);
    res.status(500).json({ message: "Failed to log upload session" });
  }
};
