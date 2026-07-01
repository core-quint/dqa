// Local development entry point — not used in Cloud Functions.
// Run: npm run dev  (from functions/)
import "dotenv/config";
import app from "./app";

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Dev server running on http://localhost:${PORT}`);
});
