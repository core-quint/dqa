import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";
import { listUsers, createUser, deleteUser, uploadGeoDataset, getGeoData } from "../controllers/admin.controller";

const router = Router();

router.use(authenticate, requireAdmin);

router.get("/users", listUsers);
router.post("/users", createUser);
router.delete("/users/:id", deleteUser);

router.post("/geo", uploadGeoDataset);
router.get("/geo", getGeoData);

export default router;
