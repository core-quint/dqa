import { Router } from "express";
import { login, register } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";

const router = Router();

// Public
router.post("/login", login);

// Admin-only: create users
router.post("/register", authenticate, requireAdmin, register);

export default router;
