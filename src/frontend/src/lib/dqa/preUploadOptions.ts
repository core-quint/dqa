// ============================================================
// Pre-upload review info: Designation / Purpose / GPS
// Collected on the HMIS and U-WIN landing pages before analysis can start.
// ============================================================
import { apiFetch } from '../../api';
import type { AuthState } from '../../components/dqa/LoginPage';

type Level = AuthState['level'];

export const DESIGNATION_OPTIONS: Record<Level, string[]> = {
  NATIONAL: ['MoHFW Officials', 'Development Partner'],
  STATE: ['SEPIO/SNO', 'State Data Manager', 'Data Entry Operator', 'Development Partner', 'State Analyst', 'State Lead'],
  DISTRICT: [
    'CS/CMO', 'RCHO/DIO/DNO', 'Assistant Research Officer', 'District Data Manager',
    'District Programme Manager', 'Data Entry Operator', 'Development Partner', 'District Coordinator',
  ],
  BLOCK: [
    'MOI/C', 'Block Medical Officer', 'Block Programme Manager', 'Block Data Manager',
    'Assistant Research Officer', 'Data Entry Operator', 'Block Health Manager',
    'Development Partner', 'District Coordinator',
  ],
};

export const PURPOSE_OPTIONS = [
  'Review Meeting', 'Desk Review', 'Training Demonstration', 'Self Learning', 'Others',
] as const;

// Each level's own meeting types, before rolling up the hierarchy below.
const REVIEW_MEETING_BASE = {
  STATE: ['State task force meeting for Immunization', 'DIO Review Meeting', 'Partners Meeting'],
  DISTRICT: [
    'District task force for Immunization', 'District Data Validation Committee',
    'District Health Society', 'District Weekly Review', 'BMO Review Meeting',
  ],
  BLOCK: [
    'Block task force for immunization', 'Block Weekly Review', 'ANM Review Meeting',
    'Block Data Validation Committee',
  ],
};

// A reviewer at a given level can plausibly sit in on meetings at their own level
// or any level below them, so each dropdown is the union of its own tier and every
// tier beneath it — National/State see everything, District sees district+block,
// Block sees just its own.
export const REVIEW_MEETING_SUBOPTIONS: Record<Level, string[]> = {
  NATIONAL: [...new Set([...REVIEW_MEETING_BASE.STATE, ...REVIEW_MEETING_BASE.DISTRICT, ...REVIEW_MEETING_BASE.BLOCK])],
  STATE: [...new Set([...REVIEW_MEETING_BASE.STATE, ...REVIEW_MEETING_BASE.DISTRICT, ...REVIEW_MEETING_BASE.BLOCK])],
  DISTRICT: [...new Set([...REVIEW_MEETING_BASE.DISTRICT, ...REVIEW_MEETING_BASE.BLOCK])],
  BLOCK: [...REVIEW_MEETING_BASE.BLOCK],
};

export interface PreUploadInfo {
  designation: string;
  purpose: string; // one of PURPOSE_OPTIONS
  purposeSubOption: string; // only meaningful when purpose === 'Review Meeting'
  purposeOtherText: string; // only meaningful when purpose === 'Others'
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAddress: string | null; // reverse-geocoded from gpsLat/gpsLng, best-effort
}

export const EMPTY_PRE_UPLOAD_INFO: PreUploadInfo = {
  designation: '',
  purpose: '',
  purposeSubOption: '',
  purposeOtherText: '',
  gpsLat: null,
  gpsLng: null,
  gpsAddress: null,
};

/** Every level (including National) must fill Designation/Purpose before upload. */
export function requiresPreUploadInfo(_level: Level): boolean {
  return true;
}

export function isPreUploadInfoComplete(info: PreUploadInfo, level: Level): boolean {
  if (!requiresPreUploadInfo(level)) return true;
  if (!info.designation || !info.purpose) return false;
  if (info.purpose === 'Review Meeting' && !info.purposeSubOption) return false;
  if (info.purpose === 'Others' && !info.purposeOtherText.trim()) return false;
  return true;
}

/** Dataset context attached to the upload-session audit log, known once the CSV parses. */
export interface UploadDatasetContext {
  state: string | null;
  district: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  blockCount: number | null;
  facilityCount: number | null;
  sessionSiteCount: number | null;
  districtCount?: number | null;
}

export function buildUploadDatasetContext(parsed: {
  stateName: string;
  distName: string;
  allMonths: Record<string, string>;
  globalBlockCount: number;
  globalFacilityCount: number;
  globalSessionSiteCount?: number;
}): UploadDatasetContext {
  const months = Object.keys(parsed.allMonths).sort();
  return {
    state: parsed.stateName || null,
    district: parsed.distName || null,
    periodStart: months[0] ?? null,
    periodEnd: months[months.length - 1] ?? null,
    blockCount: parsed.globalBlockCount ?? null,
    facilityCount: parsed.globalFacilityCount ?? null,
    sessionSiteCount: parsed.globalSessionSiteCount ?? null,
  };
}

/** Fire-and-forget audit log of who uploaded, why, and from where. Never blocks upload flow. */
export function logUploadSession(
  portal: 'HMIS' | 'UWIN' | 'HMIS_STATE' | 'PCTS',
  info: PreUploadInfo,
  dataset?: UploadDatasetContext,
): Promise<unknown> {
  return apiFetch('/api/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({ portal, ...info, ...(dataset ?? {}) }),
  });
}

/**
 * Best-effort reverse geocode via OpenStreetMap Nominatim (free, no API key).
 * Returns a short human-readable address, or null if the lookup fails.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address ?? {};
    const locality = a.city || a.town || a.village || a.suburb || a.county;
    const parts = [locality, a.state_district, a.state].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    return typeof data?.display_name === 'string' ? data.display_name : null;
  } catch {
    return null;
  }
}
