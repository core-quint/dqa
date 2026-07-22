import express, { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import {
  createUwinStateReport,
  getUwinStateReport,
  listUwinStateReports,
  downloadUwinStateReportPdf,
  uploadUwinStateReportPdf,
} from "../controllers/uwinStateReport.controller";
import { generateUwinStateNarrative, getUwinStateAiStatus } from "../controllers/uwinStateNarrative.controller";

const router = Router();

router.use(authenticate);
router.get("/ai-status", getUwinStateAiStatus);
router.post("/", createUwinStateReport);
router.get("/", listUwinStateReports);
router.post("/:id/ai-narrative", generateUwinStateNarrative);
router.put("/:id/pdf", express.raw({ type: "application/pdf", limit: "10mb" }), uploadUwinStateReportPdf);
router.get("/:id/pdf", downloadUwinStateReportPdf);
router.get("/:id", getUwinStateReport);

export default router;
