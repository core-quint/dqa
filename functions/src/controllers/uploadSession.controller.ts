import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import { AuthRequest } from "../middleware/auth.middleware";

const uploadSessionSchema = z.object({
  portal: z.enum(["HMIS", "UWIN"]),
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
});

export const createUploadSession = async (req: AuthRequest, res: Response) => {
  const parsed = uploadSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }

  const {
    portal, designation, purpose, purposeSubOption, purposeOtherText, gpsLat, gpsLng,
  } = parsed.data;

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
      userId: req.user!.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: docRef.id });
  } catch (error) {
    console.error("Upload session error:", error);
    res.status(500).json({ message: "Failed to log upload session" });
  }
};
