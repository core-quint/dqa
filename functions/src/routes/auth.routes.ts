import { Router } from "express";
import { register } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";

const router = Router();

router.post("/register", authenticate, requireAdmin, register);

export default router;
