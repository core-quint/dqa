import express, { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  createUwinStateReport,
  getUwinStateReport,
  listUwinStateReports,
  downloadUwinStateReportPdf,
  uploadUwinStateReportPdf,
  updateUwinStateReportStatus,
} from "../controllers/uwinStateReport.controller";
import { listReportActions, updateReportAction } from "../controllers/uwinStateReportAction.controller";
import { generateUwinStateNarrative, getUwinStateAiStatus } from "../controllers/uwinStateNarrative.controller";

const router = Router();

router.use(authenticate);
router.get("/ai-status", getUwinStateAiStatus);
router.post("/", createUwinStateReport);
router.get("/", listUwinStateReports);
router.patch("/:id/status", updateUwinStateReportStatus);
router.get("/:id/actions", listReportActions);
router.patch("/:id/actions/:actionId", updateReportAction);
router.post("/:id/ai-narrative", generateUwinStateNarrative);
router.put("/:id/pdf", express.raw({ type: "application/pdf", limit: "10mb" }), uploadUwinStateReportPdf);
router.get("/:id/pdf", downloadUwinStateReportPdf);
router.get("/:id", getUwinStateReport);

export default router;
