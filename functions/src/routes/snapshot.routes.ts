import { Router } from "express";
import { createSnapshot, getSnapshots, getSnapshotBreakdown, getSnapshotBreakdowns, deleteSnapshot } from "../controllers/snapshot.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createSnapshot);
router.get("/", authenticate, getSnapshots);
router.get("/breakdowns", authenticate, getSnapshotBreakdowns);
router.get("/:id/breakdown", authenticate, getSnapshotBreakdown);
router.delete("/:id", authenticate, deleteSnapshot);

export default router;
