import { Router } from "express";
import { createSnapshot, getSnapshots, deleteSnapshot } from "../controllers/snapshot.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createSnapshot);
router.get("/", authenticate, getSnapshots);
router.delete("/:id", authenticate, deleteSnapshot);

export default router;
