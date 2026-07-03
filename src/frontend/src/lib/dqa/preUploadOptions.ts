import { apiFetch } from '../../api';
import type { AuthState } from '../../components/dqa/LoginPage';

type GeoLevel = 'STATE' | 'DISTRICT' | 'BLOCK';

export const DESIGNATION_OPTIONS: Record<GeoLevel, string[]> = {
  STATE: ['SEPIO/SNO', 'State Data Manager', 'Data Entry Operator', 'Development Partner', 'State Analyst', 'State Lead',],
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

export const REVIEW_MEETING_SUBOPTIONS: Record<GeoLevel, string[]> = {
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

export interface PreUploadInfo {
  designation: string;
  purpose: string; // one of PURPOSE_OPTIONS
  purposeSubOption: string; // only meaningful when purpose === 'Review Meeting'
  purposeOtherText: string; // only meaningful when purpose === 'Others'
  gpsLat: number | null;
  gpsLng: number | null;
}

export const EMPTY_PRE_UPLOAD_INFO: PreUploadInfo = {
  designation: '',
  purpose: '',
  purposeSubOption: '',
  purposeOtherText: '',
  gpsLat: null,
  gpsLng: null,
};

function isGeoLevel(level: AuthState['level']): level is GeoLevel {
  return level === 'STATE' || level === 'DISTRICT' || level === 'BLOCK';
}

/** National-level users skip the gate entirely — the option lists don't cover that role. */
export function requiresPreUploadInfo(level: AuthState['level']): level is GeoLevel {
  return isGeoLevel(level);
}

export function isPreUploadInfoComplete(info: PreUploadInfo, level: AuthState['level']): boolean {
  if (!requiresPreUploadInfo(level)) return true;
  if (!info.designation || !info.purpose) return false;
  if (info.purpose === 'Review Meeting' && !info.purposeSubOption) return false;
  if (info.purpose === 'Others' && !info.purposeOtherText.trim()) return false;
  return true;
}

/** Fire-and-forget audit log of who uploaded, why, and from where. Never blocks upload flow. */
export function logUploadSession(portal: 'HMIS' | 'UWIN', info: PreUploadInfo): Promise<unknown> {
  return apiFetch('/api/upload-sessions', {
    method: 'POST',
    body: JSON.stringify({ portal, ...info }),
  });
}
