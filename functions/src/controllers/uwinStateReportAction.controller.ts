import { Response } from "express";
import { z } from "zod";
import { db, FieldValue } from "../lib/firebase";
import type { AuthRequest } from "../middleware/auth.middleware";
import { canAccessState } from "./uwinStateReport.controller";

const updateActionSchema = z.object({
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "OVERDUE"]),
  responsibleOfficer: z.string().trim().max(200).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  progressNote: z.string().trim().max(2000).nullable().optional(),
});

function serialize(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data()!;
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
  };
}

async function accessibleReport(req: AuthRequest, reportId: string) {
  const report = await db.collection("uwinStateReports").doc(reportId).get();
  return report.exists && canAccessState(req.user, report.data()?.state) ? report : null;
}

export const listReportActions = async (req: AuthRequest, res: Response) => {
  try {
    const reportId = req.params.id as string;
    if (!await accessibleReport(req, reportId)) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const snapshot = await db.collection("uwinStateReportActions").where("reportId", "==", reportId).get();
    const actions = snapshot.docs.map(serialize).sort((a, b) =>
      String((a as Record<string, unknown>).dueDate).localeCompare(String((b as Record<string, unknown>).dueDate)),
    );
    res.json(actions);
  } catch (error) {
    console.error("List report actions error:", error);
    res.status(500).json({ message: "Failed to load report actions" });
  }
};

export const updateReportAction = async (req: AuthRequest, res: Response) => {
  const parsed = updateActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0].message });
    return;
  }
  try {
    const reportId = req.params.id as string;
    const report = await accessibleReport(req, reportId);
    if (!report) {
      res.status(404).json({ message: "Report not found" });
      return;
    }
    const actionRef = db.collection("uwinStateReportActions").doc(req.params.actionId as string);
    const action = await actionRef.get();
    if (!action.exists || action.data()?.reportId !== reportId) {
      res.status(404).json({ message: "Action not found" });
      return;
    }
    const updates = {
      ...parsed.data,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: { id: req.user!.id, email: req.user!.email },
    };
    const batch = db.batch();
    batch.update(actionRef, updates);
    batch.set(actionRef.collection("history").doc(), {
      ...parsed.data,
      changedAt: FieldValue.serverTimestamp(),
      changedBy: { id: req.user!.id, email: req.user!.email },
    });
    await batch.commit();
    res.json(serialize(await actionRef.get()));
  } catch (error) {
    console.error("Update report action error:", error);
    res.status(500).json({ message: "Failed to update report action" });
  }
};
