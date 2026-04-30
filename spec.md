# Data Quality Assessment - Desk Review

## Current State
A new Caffeine (React + Motoko) project with empty frontend and backend scaffolding. No components or logic yet.

## Requested Changes (Diff)

### Add
- **Access gate**: Full-screen 7-digit code prompt shown every time the app loads. Code: `1234567`. On failure, show error. On success, unlock app.
- **Landing page**: Logo, title, CSV upload form, four DQA info cards (Availability, Completeness, Accuracy, Consistency), link to HMIS portal, instructions text.
- **CSV parsing (frontend)**: Parse uploaded CSV in-browser using PapaParse. Detect required headers (Block Name, Facility Name, Month) and optional headers (Ownership, Rural/Urban, State, District). Map vaccine indicator columns by HMIS code prefix (9.1.x, 9.2.x, 9.4.x).
- **All KPI computations (frontend)**: All data processing happens in-browser (no backend DB needed):
  - *Availability* — t1: All indicators blank; t0: All zeros but not blank; t7: All same repeating non-zero values
  - *Completeness* — t2: Key missing indicators (blank cells per vaccine per month)
  - *Accuracy* — t6: Sessions Held > Sessions Planned; t3: Outliers (consecutive month % change in buckets); dropout pairs with configurable % ranges
  - *Consistency* — i1: Penta3>Penta1; i2: OPV3>OPV1; dynamic user-defined inconsistency pairs; co-administration groups (co1–co5)
- **Filter panel**: Block selector, Month selector, Key Indicators, Outlier buckets, Dropout ranges & pairs (with pair-builder UI), Inconsistency pair builder, Ownership, Rural/Urban, Additional Indicators. Filters apply on demand (Apply Filter button).
- **Component group navigation**: 4 buttons (Availability, Completeness, Accuracy, Consistency) show/hide relevant KPI cards and panels.
- **KPI cards**: Per-KPI count cards with "Any month" / "All months" split. Top-3 affected indicators shown for Completeness and Outliers.
- **Chart/Table/Summary toggle panels**: Per KPI, show bar chart (Chart.js) by block, data table, or summary table. Panels with 0 results hidden.
- **Consistency panels split**: Two sub-groups — "Inconsistencies between doses" and "Inconsistencies between vaccines".
- **Info row**: State, District, Duration, Number of Blocks, Number of Facilities (with Public/Private/Rural/Urban breakdown).
- **Overall Score overlay**: Full-screen view with doughnut ring chart (overall score 0–100), component mini-scores, impact bars (Any/All months), top KPI tables, highlights bar charts per component. Score = avg(100 − worst_KPI_% per component).
- **XLS export**: Client-side download of summary tables as `.xls` (HTML table format).
- **Highlighted XLS export**: Full-file download with pink/dark-pink cell highlights per KPI logic.
- **Chart PNG download**: Client-side canvas `toDataURL()` download.
- **Start Over**: Clears all state and returns to landing/upload page.

### Modify
- Nothing (greenfield project).

### Remove
- Nothing.

## Implementation Plan
1. Write spec.md (this file). Rename project.
2. No Caffeine components needed (all logic is client-side CSV processing).
3. No Motoko backend needed (all computation is in-browser; no persistent storage required).
4. Build frontend:
   a. Access gate screen (passcode: `1234567`)
   b. Landing/upload page with CSV drag-and-drop
   c. CSV parser utility (PapaParse + indicator detection + month parsing)
   d. KPI computation engine (all 4 groups)
   e. Filter state management (React state / context)
   f. Results page: info row, component buttons, filter panel, KPI cards, panels grid
   g. Chart panels using Chart.js via react-chartjs-2
   h. Overall Score overlay
   i. Export utilities (XLS, highlighted XLS, chart PNG)
5. Deploy.

## UX Notes
- The app is entirely client-side. CSV data never leaves the browser.
- Access code is checked on every fresh load (not persisted in localStorage).
- Group buttons visually distinguish the 4 DQA components with color coding: blue (Availability), indigo (Completeness), orange (Accuracy), green (Consistency).
- Panels with 0 flagged facilities are hidden automatically.
- Consistency KPI cards and panels are split into two labelled sub-groups.
- Filters are context-sensitive: vaccine/outlier/dropout filters only show for Accuracy; inconsistency pair builder only for Consistency.
- Overall Score button appears only after filters are applied.
- "Start Over" resets everything and returns to landing page.
