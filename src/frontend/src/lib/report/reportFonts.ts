// Fonts for the DQA brief PDF (lib/report/briefPdf.ts): Poppins Bold for
// headings and DQA Brief Text — a renamed subset of Carlito, with Calibri's
// metrics, so text sets exactly as in the brief template — for the body.
// Both SIL OFL 1.1 (assets/fonts/*-OFL.txt). Fetched only when a brief is
// generated, then kept for the session.
import type { BriefFonts } from "./briefPdf";

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

async function load(): Promise<BriefFonts> {
  const urls = await Promise.all([
    import("../../../assets/fonts/DQABriefText-Regular.ttf?url"),
    import("../../../assets/fonts/DQABriefText-Bold.ttf?url"),
    import("../../../assets/fonts/DQABriefText-Italic.ttf?url"),
    import("../../../assets/fonts/DQABriefText-BoldItalic.ttf?url"),
    import("../../../assets/fonts/Poppins-Bold.ttf?url"),
  ]);
  const [regular, bold, italic, boldItalic, heading] = await Promise.all(urls.map((url) => base64Of(url.default)));
  return { regular, bold, italic, boldItalic, heading };
}

let cached: Promise<BriefFonts | null> | null = null;

/** The brief fonts, or null (Helvetica fallback) when they cannot be loaded. */
export function loadBriefFonts(): Promise<BriefFonts | null> {
  cached ??= load().catch(() => {
    cached = null;
    return null;
  });
  return cached;
}
