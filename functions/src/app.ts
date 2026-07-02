import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes";
import snapshotRoutes from "./routes/snapshot.routes";
import adminRoutes from "./routes/admin.routes";

const app = express();

app.use(cors({ origin: true, credentials: true }));

app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/snapshots", snapshotRoutes);
app.use("/api/admin", adminRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal server error" });
});

export default app;
