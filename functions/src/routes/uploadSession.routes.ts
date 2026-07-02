import { Router } from "express";
import { createUploadSession } from "../controllers/uploadSession.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/", authenticate, createUploadSession);

export default router;
