// IBM Plex Sans (SIL OFL 1.1, assets/fonts/IBMPlexSans-OFL.txt) for the PDF
// reports — the app's own typeface, with the arrows, ≥ and dashes Helvetica
// lacks. Fetched only when a report is generated, then kept for the session.
import type { ReportFonts } from "./dqaReportPdf";

let cached: Promise<ReportFonts | null> | null = null;

async function base64Of(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function load(): Promise<ReportFonts> {
  const [regular, semibold] = await Promise.all([
    import("../../../assets/fonts/IBMPlexSans-Regular.ttf?url"),
    import("../../../assets/fonts/IBMPlexSans-SemiBold.ttf?url"),
  ]);
  const [regularData, semiboldData] = await Promise.all([base64Of(regular.default), base64Of(semibold.default)]);
  return { regular: regularData, semibold: semiboldData };
}

/** The report fonts, or null (Helvetica fallback) when they cannot be loaded. */
export function loadReportFonts(): Promise<ReportFonts | null> {
  cached ??= load().catch(() => {
    cached = null;
    return null;
  });
  return cached;
}
