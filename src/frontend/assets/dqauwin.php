
<?php



if (session_status() === PHP_SESSION_NONE) { session_start(); }
if (empty($_SESSION['dqa_gateway'])) {
    http_response_code(403);
    echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Access Restricted</title></head><body style="font-family:Arial,sans-serif;text-align:center;padding-top:80px;">
    <h2>Device/Network change or Direct Access is detected</h2>
    <p>To restore session variables, please open this tool from the DQA Tools page.</p>
    <p><a href="https://www.datamgmt.in/dqa.php" style="font-size:18px;">Go to DQA Tools page</a></p>
    </body></html>';
    exit;
}

/* ==================================================================
   (added) Logout + 10-minute idle auto-logout
   ------------------------------------------------------------------
   - "?dqa_logout=1": removes every piece of uploaded data held for
     this user on the server (the analysis lives in the PHP session;
     the uploaded file itself is never saved to disk) and returns to
     the DQA Tools page (dqa.php).
   - "?dqa_keepalive=1": background ping from the page while the user
     is active; it only refreshes the last-activity time (204, no body).
   - "?dqa_idle_logout=1": sent by the page after 10 idle minutes.
     Server-verified: it only logs out when the server also saw no
     activity for at least 5 minutes, so an active session in another
     tab is never destroyed by a stale tab.
   - Hard server-side check: any normal request arriving after more
     than 10 idle minutes is logged out first (data removed), with a
     notice when analysis data existed.
   These handlers run before the access-code gate on purpose: they
   must work without re-asking the access code, and they only remove
   data / redirect, so this is safe.
   ================================================================== */
function dqa_tool_cleanup_session(){
	$dqa_keys = array('csv_header','csv_norm','csv_rows','idxBlock','idxFac','idxMonth','idxOwner','idxRU','idxState','idxDist','idxSubCentre','file_name','file_names','filters','hasApplied','just_uploaded','exports','pink_fac_sets','pink_outlier_hits','pink_dropout_hits','pink_repeat_hits','allMonthsMap','drop_pair_map','incons_pair_map','dqa_access_granted','dqa_last_seen','dqa_log_id','dqa_log_state','dqa_launch','dqa_launch_logid','dqa_hl','dqa_upload_id','dqa_upload_tool','dqa_upload_sig','dqa_render_id','uwx_periods','uwx_duration');
	foreach($dqa_keys as $dqa_k){ unset($_SESSION[$dqa_k]); }
}
function dqa_idle_script(){
?>
<script>
(function(){
	var DQA_IDLE_MS = 600000;       /* 10 minutes */
	var DQA_PING_MS = 120000;       /* keep-alive every 2 minutes while active */
	var DQA_ACTIVE_WINDOW = 150000; /* "active" = user activity within the last 2.5 minutes */
	var dqaLastActivity = Date.now();
	var dqaLastTick = Date.now();
	var dqaLastPing = 0;
	function dqaAct(){ dqaLastActivity = Date.now(); }
	var dqaEvs = ['mousemove','mousedown','keydown','scroll','touchstart','click'];
	for (var dqaI = 0; dqaI < dqaEvs.length; dqaI++) { document.addEventListener(dqaEvs[dqaI], dqaAct, true); }
	function dqaIdleLogout(){ window.location.href = '?dqa_idle_logout=1'; }
	setInterval(function(){
		var dqaNow = Date.now();
		if (dqaNow - dqaLastTick > DQA_IDLE_MS + 60000) { dqaIdleLogout(); return; } /* device slept past the idle limit */
		dqaLastTick = dqaNow;
		if (dqaNow - dqaLastActivity >= DQA_IDLE_MS) { dqaIdleLogout(); return; }
		if (dqaNow - dqaLastActivity <= DQA_ACTIVE_WINDOW && dqaNow - dqaLastPing >= DQA_PING_MS) {
			dqaLastPing = dqaNow;
			try {
				if (window.fetch) { fetch('?dqa_keepalive=1', {cache:'no-store',credentials:'same-origin'}); }
				else { var dqaX = new XMLHttpRequest(); dqaX.open('GET','?dqa_keepalive=1',true); dqaX.send(); }
			} catch(dqaE){}
		}
	}, 30000);
})();
</script>
<?php
}
if (isset($_GET['dqa_keepalive'])) {
	$_SESSION['dqa_last_seen'] = time();
	http_response_code(204);
	exit;
}
if (isset($_GET['dqa_logout'])) {
	dqa_tool_cleanup_session();
	header('Location: https://www.datamgmt.in/dqa.php');
	exit;
}
if (isset($_GET['dqa_idle_logout'])) {
	$dqa_idle_last = isset($_SESSION['dqa_last_seen']) ? (int)$_SESSION['dqa_last_seen'] : 0;
	if ($dqa_idle_last === 0 || (time() - $dqa_idle_last) >= 300) {
		$dqa_idle_had_data = isset($_SESSION['csv_header']) || isset($_SESSION['csv_rows']);
		dqa_tool_cleanup_session();
		$dqa_idle_msg = $dqa_idle_had_data
			? 'You have been logged out after 10 minutes of inactivity. The data you uploaded has been removed from the server.'
			: 'You have been logged out after 10 minutes of inactivity.';
		echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Logged out</title></head><body>'
		   . '<script>alert(' . json_encode($dqa_idle_msg) . '); window.location.replace("https://www.datamgmt.in/dqa.php");</script>'
		   . '<noscript><p>' . htmlspecialchars($dqa_idle_msg, ENT_QUOTES, 'UTF-8') . '</p><p><a href="https://www.datamgmt.in/dqa.php">Go to DQA Tools page</a></p></noscript>'
		   . '</body></html>';
		exit;
	}
	http_response_code(204);
	exit;
}
/* Hard server-side idle check for normal requests. */
$dqa_hard_last = isset($_SESSION['dqa_last_seen']) ? (int)$_SESSION['dqa_last_seen'] : 0;
if ($dqa_hard_last > 0 && (time() - $dqa_hard_last) > 600) {
	$dqa_hard_had_data = isset($_SESSION['csv_header']) || isset($_SESSION['csv_rows']);
	dqa_tool_cleanup_session();
	if ($dqa_hard_had_data) {
		echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Logged out</title></head><body>'
		   . '<script>alert("You have been logged out after 10 minutes of inactivity. The data you uploaded has been removed from the server."); window.location.replace("https://www.datamgmt.in/dqa.php");</script>'
		   . '<noscript><p>You have been logged out after 10 minutes of inactivity. The data you uploaded has been removed from the server.</p><p><a href="https://www.datamgmt.in/dqa.php">Go to DQA Tools page</a></p></noscript>'
		   . '</body></html>';
		exit;
	}
}
$_SESSION['dqa_last_seen'] = time();
/* ============== end of added logout / idle-logout block ============== */


/**
 * Data Quality Assessment - Desk Review (Single File HTML+PHP)
 * REV Z3e8 (REV Z3e7 + requested fixes)
 *
 * ONLY CHANGES IMPLEMENTED (as requested by user now):
 * 1) If a KPI card has 0 values, its related chart/table panel is not shown (hidden).
 * 2) Inconsistencies KPI charts use the same light green color as their KPI cards.
 * 3) When “Consistency” button is pressed, show a dropdown to create one or more additional
 *    Inconsistencies pairs (pair-builder UI like Dropouts), placed before “Additional Filter”.
 *    Additional Inconsistencies pairs generate corresponding KPI cards + charts + tables + exports.
 *
 * EVERYTHING ELSE KEPT THE SAME.
 *
 * (changed 2026-11) WEB PARITY - the analysis is the DQA web application's U-WIN analysis
 * (web parity engine, uwx_* functions): Weekly / Monthly upload with the From - To dates of
 * every file; units Sub Center-wise by default, or Facility-wise / Session Site-wise (Analysis
 * level switch); the same checks, rules, weights (scoring method v8) and Overall Score as the
 * web application's U-WIN portal. "Download Report" (the former "Download to PDF") saves the
 * web application's two-page DQA brief (assets/report/dqa_brief_report.js); the 2-pager test
 * button, the "Download Word" export and "Public facilities reporting Typhoid" were removed.
 */



$APP_NAME = "UWIN Data Quality Assessment - Desk Review";
$BASE_URL = basename(__FILE__);
/* IMPORTANT: Do not hardcode real credentials here in shared code. */
$DB_HOST = 'localhost';
$DB_USER = 'YOUR_DB_USER';
$DB_PASS = 'YOUR_DB_PASS';
$DB_NAME = 'YOUR_DB_NAME';
$STORE_TO_DB = false; // meta only (kept off)
/* (added) "Public facilities reporting Typhoid": U-WIN exports usually carry no Ownership
   column. When the file's "Facility Category" column holds NUMERIC codes, list here the
   code(s) that mean Government / Public (as strings, e.g. array('1')). Leave empty until the
   codes are confirmed from the U-WIN portal - until then the indicator is shown only for files
   whose ownership can be read from an Ownership column or a TEXT Facility Category / Type
   column (Gvt / Government / Public / Private). */
$DQA_UWIN_PUBLIC_CATEGORY_CODES = array();
$DEBUG = isset($_GET['debug']) ? 1 : 0;

/* Strong anti-cache */
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

/* Errors */
ini_set('display_errors', $DEBUG ? '1' : '0');
if ($DEBUG) { error_reporting(E_ALL); }
ini_set('log_errors', '1');
ini_set('error_log', sys_get_temp_dir() . '/dqa_desk_review.log');

/*session_start();*/

/* Runtime guards for heavy CSV uploads / analysis (does not change any calculations or UI) */
@ini_set('memory_limit', '1024M');
@ini_set('max_execution_time', '0');
@set_time_limit(0);
@ignore_user_abort(true);


/* -------------------- Simple Access Gate (7-digit code) -------------------- */
/*
  Requirement: Ask access code EVERY time the site is opened (no remember on same system).
  Implementation: No persistent session flag; access is validated per-request via POST/GET.
  The validated code is carried forward via hidden fields and download links.
*/
// Change this 7-digit code as needed
$SITE_ACCESS_CODE = '1234567';

$ACCESS_CODE_CURRENT = '';
$access_ok = false;

if (isset($_POST['access_code']) || isset($_GET['access_code'])) {
    $raw = isset($_POST['access_code']) ? $_POST['access_code'] : $_GET['access_code'];
    $code = preg_replace('/\D+/', '', (string)$raw);
    if (strlen($code) === 7 && $code === $SITE_ACCESS_CODE) {
        $access_ok = true;
        $ACCESS_CODE_CURRENT = $code;
    }
}


/* -------------------- Access Gate download bypass (requested) --------------------
   When user clicks "Actual data with highlighted cells", do NOT re-prompt for access code.
   We keep the "per-open" access behavior for normal page loads, but allow the download
   request to proceed if access was already granted earlier in this browser session.
*/
if ($access_ok) {
    $_SESSION['dqa_access_granted'] = 1;
} else {
    // Allow only the highlighted-cells download to proceed without re-entering code
    if (isset($_GET['download_pink']) && !empty($_SESSION['dqa_access_granted'])) {
        $access_ok = true;
        $ACCESS_CODE_CURRENT = $SITE_ACCESS_CODE; // for downstream link building, if needed
    }
}

if (!$access_ok) {
    $err = (isset($_POST['access_code']) || isset($_GET['access_code']));
    ?><!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>UWIN Data Quality Assessment - Access Code Required</title>
    <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff7ed;margin:0;padding:24px;}
        .box{max-width:520px;margin:10vh auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px 24px;box-shadow:0 18px 40px rgba(2,6,23,.08);}
        h1{margin:0 0 8px 0;font-size:20px;color:#0f172a;}
        p{margin:0 0 16px 0;color:#475569;font-size:14px;line-height:1.45}
        input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;outline:none}
        input:focus{border-color:#64748b;box-shadow:0 0 0 4px rgba(100,116,139,.18)}
        button{margin-top:12px;width:100%;padding:12px 14px;border:0;border-radius:12px;background:#1d4ed8;color:#fff;font-weight:800;font-size:15px;cursor:pointer}
        .err{margin-top:10px;color:#b91c1c;font-weight:800;font-size:13px;}
    </style>
	<?php echo uwin_theme_css_tag(); ?>
</head><body>
    <div class="box">
        <h1>UWIN Data Quality Assessment - Access Code Required</h1>
        <p>Please enter the 7-digit access code to use this website.</p>
        <form method="post">
            <input type="password" inputmode="numeric" pattern="\d{7}" maxlength="7" name="access_code" placeholder="Enter 7-digit code" required>
            <button type="submit">Continue</button>
        </form>
        <?php if($err){ ?><div class="err">Invalid access code.</div><?php } ?>
    </div>
    </body></html><?php
    exit;
}

$ACCESS_QS = 'access_code=' . rawurlencode($GLOBALS['ACCESS_CODE_CURRENT']);
/* -------------------- PHP < 8 compatibility shims -------------------- */
if (!function_exists('str_contains')) {
	function str_contains($haystack, $needle) {
		$haystack = (string)$haystack;
		$needle = (string)$needle;
		if ($needle === '') return true;
		return strpos($haystack, $needle) !== false;
	}
}
if (!function_exists('str_starts_with')) {
	function str_starts_with($haystack, $needle) {
		$haystack = (string)$haystack;
		$needle = (string)$needle;
		if ($needle === '') return true;
		return substr($haystack, 0, strlen($needle)) === $needle;
	}
}

/* -------------------- Helpers -------------------- */
function h($s){ return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

// Display labels: show fIPV1/2/3 instead of IPV1/2/3 (UI labels only)
function display_vax_label($vx){
	$vx = (string)$vx;
	if($vx==='IPV1') return 'fIPV1';
	if($vx==='IPV2') return 'fIPV2';
	if($vx==='IPV3') return 'fIPV3';
	return $vx;
}

function coadmin_has_highlighted_difference($vals){
	$norm = [];
	$counts = [];
	foreach((array)$vals as $v){
		if($v === null || $v === '') continue;
		if(is_numeric($v)){
			$k = sprintf('%.10F', (float)$v);
		}else{
			$k = strtolower(trim((string)$v));
		}
		$norm[] = $k;
		$counts[$k] = isset($counts[$k]) ? $counts[$k] + 1 : 1;
	}
	if(count($norm) < 2) return false;
	/* CHANGED (required for the new Consistency red rule): a difference exists whenever the
	   present values disagree (e.g., 3 vaccines same and 2 vaccines same but different, or vice
	   versa) — previously only rows containing a UNIQUE value were flagged, which skipped
	   exactly the 3-2 split scenario. */
	return (count($counts) > 1);
}

// Apply fIPV label replacement inside longer UI strings
function display_text_with_fipv($s){
	$s = (string)$s;
	return str_replace(['IPV1','IPV2','IPV3'], ['fIPV1','fIPV2','fIPV3'], $s);
}

function strip_bom($s){ if(substr((string)$s,0,3)==="\xEF\xBB\xBF") return substr((string)$s,3); return (string)$s; }
function normalize_loose_text($s){
	$s = strip_bom((string)$s);
	// Replace NBSP and common odd spaces
	$s = str_replace(array("\xC2\xA0", "Â "), ' ', $s);
	// Remove zero-width / format characters that often break header matching
	$s = preg_replace('/\p{Cf}+/u', '', $s);
	// Normalize common Unicode dashes to ASCII hyphen
	$s = str_replace(array("–","—","−","‑","﹣","－"), "-", $s);
	// Normalize newlines/tabs
	$s = preg_replace('/[\r\n\t]+/u',' ', $s);
	$s = trim($s);
	$s = preg_replace('/\s+/u',' ',$s);
	if(function_exists('mb_strtolower')) return mb_strtolower($s, 'UTF-8');
	return strtolower($s);
}
function normalize_header($s){
	return normalize_loose_text($s);
}
/* (changed 2026-10) A blank cell (or NA / N/A / null / -, or text without a number)
   stays BLANK - it is never read as 0, so an unreported row is not flagged as
   "All Indicators 0", "Zero coverage session" or "Avg Beneficiaries < 5". */
function sanitize_number($raw){
	if($raw===null) return '';
	if(is_int($raw) || is_float($raw)) return $raw + 0;
	$s = strip_bom((string)$raw);
	$s = str_replace(array("\xC2\xA0", "Â "), ' ', $s);
	$s = trim($s);
	if($s==='') return '';
	$low = function_exists('mb_strtolower') ? mb_strtolower($s,'UTF-8') : strtolower($s);
	if($low==='na' || $low==='n/a' || $low==='null' || $low==='-' ) return '';
	// Remove thousand separators and stray spaces inside numbers
	$s = str_replace(',', '', $s);
	$s = preg_replace('/(?<=\d)\s+(?=\d)/u','', $s);
	if(is_numeric($s)) return $s + 0;
	if(preg_match('/-?\d+(?:\.\d+)?/u', $s, $m)) return $m[0] + 0;
	return '';
}

/* -------------------- Theme (Look only) -------------------- */
function uwin_theme_css(){
	// A distinct "UWIN Aurora" theme to visually differentiate from older DQA tools (look-only changes).
	return <<<CSS
:root{
	--uwin-accent-1:#10b981; /* emerald */
	--uwin-accent-2:#f59e0b; /* amber */
	--uwin-accent-3:#06b6d4; /* cyan */
	--uwin-ink:#0b1220;
	--uwin-panel:rgba(255,255,255,.88);
	--uwin-border:rgba(15,23,42,.10);
}
/* Global background */
body{
	background:
		radial-gradient(circle at 12% 18%, rgba(16,185,129,.22), transparent 55%),
		radial-gradient(circle at 88% 22%, rgba(245,158,11,.18), transparent 52%),
		radial-gradient(circle at 70% 90%, rgba(6,182,212,.16), transparent 55%),
		linear-gradient(135deg, #fff7ed 0%, #ecfeff 38%, #f0fdf4 100%) fixed !important;
}
/* Soft pattern overlay */
body::before{
	content:"";
	position:fixed; inset:0;
	background:
		repeating-linear-gradient(45deg, rgba(15,23,42,.025) 0 1px, transparent 1px 12px);
	opacity:.55;
	pointer-events:none;
	z-index:-1;
}
/* Brand elements */
.logo, .cardHeader, a.btn, button.btn, button{
	background:linear-gradient(135deg,var(--uwin-accent-1),var(--uwin-accent-2)) !important;
}
.logo{
	box-shadow:0 14px 34px rgba(16,185,129,.22) !important;
}
.card, .topbar, .infoBox{
	background:var(--uwin-panel) !important;
	border:1px solid var(--uwin-border) !important;
	backdrop-filter:saturate(130%) blur(10px);
	-webkit-backdrop-filter:saturate(130%) blur(10px);
}
/* Headings */
.title h1{ text-shadow:0 10px 22px rgba(15,23,42,.18); }
.title p{ color:rgba(11,18,32,.75) !important; }
/* Minor accents */
.kpi h4{ color:var(--uwin-accent-1) !important; }
.statValue{ color:#064e3b !important; }
CSS;
}
function uwin_theme_css_tag(){
	return "<style>".uwin_theme_css()."</style>";
}


function is_probably_second_header_row($h1, $h2){
	// Detect the special UWIN "two-row header" format safely.
	// IMPORTANT: Do NOT misclassify the first data row as a header row (common when many numeric cells exist).
	if(!is_array($h1) || !is_array($h2)) return false;
	$n1 = count($h1); $n2 = count($h2);
	if($n1===0 || $n2===0) return false;

	// Row-1 must clearly look like a header containing the vaccine label phrase
	$h1_has_vacc = false;
	foreach($h1 as $c){
		$cl = normalize_loose_text($c);
		if(strpos($cl,'children vaccin')!==false || strpos($cl,'vaccinat')!==false){ $h1_has_vacc = true; break; }
	}
	if(!$h1_has_vacc) return false;

	// Known UWIN short codes commonly present in the 2nd header row
	$known = array(
		'bcg','hepb0','hep b0','hep b','opv0','opv-0','opv1','opv-1','opv2','opv-2','opv3','opv-3','opv booster','opv-booster',
		'rvv1','rvv2','rvv3',
		'penta1','penta-1','penta2','penta-2','penta3','penta-3',
		'pcv1','pcv-1','pcv2','pcv-2','pcv 2','pcv booster','pcvbooster',
		'ipv1','ipv-1','fipv1','fipv-1','ipv2','fipv2','ipv3','fipv3',
		'mr1','mr-1','mr2','mr-2',
		'dpt 1','dpt1','dpt 2','dpt2','dpt 3','dpt3',
		'dpt booster 1','dpt booster1','dpt 1st booster','dptb1',
		'je1','je-1','je2','je-2',
		'mmr','typhoid','dpt booster 2','dpt booster2','dptb2'
	);

	$nonEmpty = 0;
	$hits = 0;
	$numericLike = 0;
	$codeLike = 0;
	$lengths = [];

	foreach($h2 as $c){
		$cl2 = normalize_loose_text($c);
		if($cl2==='') continue;
		$nonEmpty++;

		// If a large fraction of row-2 cells are numeric, it's almost certainly DATA (not a header).
		if(preg_match('/^[+-]?\d+(?:\.\d+)?$/', str_replace(',','', $cl2))){
			$numericLike++;
			continue;
		}

		$lengths[] = mb_strlen($cl2, 'UTF-8');

		// known-code hits
		$compact = preg_replace('/\s+/u','', $cl2);
		foreach($known as $k){
			$k2 = normalize_loose_text($k);
			$k2c = preg_replace('/\s+/u','', $k2);
			if($cl2===$k2 || $compact===$k2c){
				$hits++;
				break;
			}
		}

		// "code-like" heuristic: short-ish, mostly alnum/dash/space, not too many words
		$words = preg_split('/\s+/u', trim($cl2));
		if(mb_strlen($cl2,'UTF-8')<=14 && count($words)<=3 && preg_match('/^[a-z0-9 \-]+$/u', $cl2)){
			$codeLike++;
		}
	}

	if($nonEmpty===0) return false;

	// Guard: if numeric ratio is high, it's data row, not header row.
	$numericRatio = $numericLike / max(1,$nonEmpty);
	if($numericRatio >= 0.35) return false;

	// Strong evidence of 2nd header row: multiple known-code hits
	if($hits >= 3) return true;

	// Moderate evidence: some known hits + mostly code-like entries + short median length
	$codeRatio = $codeLike / max(1, ($nonEmpty - $numericLike));
	$medianLen = null;
	if(count($lengths)>0){
		sort($lengths);
		$mid = (int)floor((count($lengths)-1)/2);
		$medianLen = $lengths[$mid];
	}
	if($hits >= 2 && $codeRatio >= 0.50 && ($medianLen===null || $medianLen <= 10)) return true;

	return false;
}

function merge_two_header_rows($h1, $h2){
	$out = [];
	$max = max(count($h1), count($h2));
	$knownCompact = array(
		'bcg'=>true,'hepb0'=>true,'opv0'=>true,'opv1'=>true,'opv2'=>true,'opv3'=>true,
		'rvv1'=>true,'rvv2'=>true,'rvv3'=>true,
		'penta1'=>true,'penta2'=>true,'penta3'=>true,
		'ipv1'=>true,'ipv2'=>true,'ipv3'=>true,
		'pcv1'=>true,'pcv2'=>true,'pcvbooster'=>true,
		'mr1'=>true,'mr2'=>true,
		'dpt1stbooster'=>true,'dptbooster1'=>true,'dptbooster2'=>true
	);
	for($i=0;$i<$max;$i++){
		$a = isset($h1[$i]) ? strip_bom(trim((string)$h1[$i])) : '';
		$b = isset($h2[$i]) ? strip_bom(trim((string)$h2[$i])) : '';
		$bn = normalize_loose_text($b);
		$compact = str_replace(array(' ','-'),'',$bn);
		// Use 2nd-row value if it looks like a short code; else fall back to 1st-row label
		if($b!=='' && (isset($knownCompact[$compact]) || preg_match('/^[a-z]{2,8}\s*\d{0,2}(\s*booster)?(\s*\d+)?$/iu', $b))){
			$out[] = $b;
		} else {
			$out[] = $a;
		}
	}
	return $out;
}

function normalize_facility_key($s){
	// Facility key for *counting only*.
	// To match Excel Pivot distinct counts, treat facility names case-insensitively
	// (Excel/Data Model DISTINCTCOUNT is effectively case-insensitive for text).
	// Do NOT change display text; only the counting key.
	$s = strip_bom((string)$s);
	// Convert NBSP variants to normal space, then trim.
	$s = str_replace(array("\xC2\xA0", "Â "), ' ', $s);
	$s = trim($s);
	if(function_exists('mb_strtolower')) return mb_strtolower($s);
	return strtolower($s);
}
function month_key($raw){
	$rawStr = trim((string)$raw);
	if($rawStr==='') return null;

	// Prefer explicit Month-Year patterns from CSV (avoid interpreting "Apr-25" as a day in the current year)
	if(preg_match('/^([A-Za-z]{3,9})\s*[-\/\s]\s*(\d{2}|\d{4})$/', $rawStr, $m)){
		$mon = $m[1];
		$yy  = $m[2];
		$year = (strlen($yy)===2) ? (2000 + (int)$yy) : (int)$yy;

		// Normalize month name to 3-letter English abbreviation for parsing
		$mon3 = substr(ucfirst(strtolower($mon)), 0, 3);
		$dt = DateTime::createFromFormat('!M Y', $mon3.' '.$year);
		if($dt instanceof DateTime){
			return $dt->format('Y-m');
		}
	}

	// Fallback for full dates / other parseable formats
	$ts = strtotime($rawStr);
	if($ts===false) return null;
	return date('Y-m',$ts);
}
function month_short_label($raw){
	$mk = month_key($raw);
	if($mk===null) return (string)$raw;
	return month_label_from_key($mk);
}
function month_label_from_key($ym){
	$ts = strtotime($ym.'-01');
	if($ts===false) return $ym;
	return date('M',$ts);
}
function month_label_from_key_my($ym){
	$ts = strtotime($ym.'-01');
	if($ts===false) return $ym;
	return date('M-y',$ts);
}
function months_span_inclusive($minYM, $maxYM){
	$a = explode('-', (string)$minYM);
	$b = explode('-', (string)$maxYM);
	if(count($a)!=2 || count($b)!=2) return null;
	$y1=(int)$a[0]; $m1=(int)$a[1];
	$y2=(int)$b[0]; $m2=(int)$b[1];
	return (($y2-$y1)*12 + ($m2-$m1) + 1);
}
function as_num_or_null($v){
	if($v===null) return null;
	if(is_string($v) && trim($v)==='') return null;
	if(!is_numeric($v)) return null;
	return (float)$v;
}
function pct_change($prev,$curr){
	if($prev===null||$curr===null) return null;
	if($prev==0) return null;
	return ($curr-$prev)/$prev;
}
function normalize_ownership($v){
	$s = trim(function_exists('mb_strtolower') ? mb_strtolower((string)$v) : strtolower((string)$v));
	if($s==='') return '';
	if(preg_match('/^pub/i',$s) || str_contains($s,'government') || str_contains($s,'govt')) return 'Public';
	if(preg_match('/^pri/i',$s) || str_contains($s,'pvt') || str_contains($s,'private')) return 'Private';
	return ucfirst($s);
}
function normalize_ru($v){
	$s = trim(function_exists('mb_strtolower') ? mb_strtolower((string)$v) : strtolower((string)$v));
	if($s==='') return '';
	if(str_starts_with($s,'rur')) return 'Rural';
	if(str_starts_with($s,'urb')) return 'Urban';
	return ucfirst($s);
}
function safe_key($s){
	$s = (string)$s;
	$s = str_replace(['→','—','–','>','<',':','/','\\','|','?','*','"',"'",',',';','(',')','[',']','{','}'], '_', $s);
	$s = preg_replace('/\s+/','_', $s);
	$s = preg_replace('/[^A-Za-z0-9_\-]+/','_', $s);
	$s = trim($s,'_');
	if($s==='') $s='key';
	return strtolower($s);
}
/* UI-only: display label for blank block */
function display_block_label($b){
	$b = trim((string)$b);
	return ($b==='') ? 'Unknown block' : $b;
}

/* ==================================================================
   (added 2026-08) Dual source-file format support.
   The newer UWIN "Session Site" export no longer contains a
   "Health Facility Name" column (nor "Sub Centre Name"). When the
   uploaded file has no facility column, every table and every export
   shows LGD Block Name + Session Site Name only; when it does have
   one (older exports) nothing changes at all.
   $GLOBALS['DQA_HAS_FAC'] is set once, right after the facility
   column index is resolved, and drives all of the helpers below.
   ================================================================== */
/* (changed 2026-11, web parity) identity columns of the analysis level on screen:
   LGD Block Name + Health Facility Name, + Sub Center Name (Sub Center-wise) or + Session
   Site Name (Session Site-wise). $GLOBALS['DQA_MODE'] is set by render_results_with_data(). */
function dqa_mode(){ return isset($GLOBALS['DQA_MODE']) ? (string)$GLOBALS['DQA_MODE'] : 'facility'; }
function dqa_has_fac(){ return true; }
function dqa_id_head(){ $h = ['LGD Block Name','Health Facility Name']; if(dqa_mode()==='subcenter') $h[] = 'Sub Center Name'; elseif(dqa_mode()==='sessionsite') $h[] = 'Session Site Name'; return $h; }
function dqa_id_blank(){ return array_fill(0, count(dqa_id_head()), ''); }
function dqa_id_row($block,$fac,$sess){ $r = [$block,$fac]; if(dqa_mode()!=='facility') $r[] = $sess; return $r; }
function dqa_id_th(){ foreach(dqa_id_head() as $hh){ echo "<th rowspan='2'>".h($hh)."</th>"; } }
function dqa_id_td($block,$fac,$sess){ foreach(dqa_id_row($block,$fac,$sess) as $vv){ echo "<td>".h($vv)."</td>"; } }
/* Identifier columns that must never be treated as numeric indicators,
   even if a future export places them after the Month column. */
function dqa_is_non_indicator_col($hdr){
	$n = normalize_header($hdr);
	/* (changed 2026-10-14) a column with a BLANK header (e.g. a stray trailing column in
	   an Excel-saved export) is never an indicator either. */
	return ($n==='' || $n==='facility category' || $n==='facility type' || $n==='facility sub-type'
	     || $n==='facility subtype' || $n==='type' || $n==='session type');
}

/* (added 2026-10-14) ONE rule for the Availability KPI "All Indicators having 0 values but
   not blank", shared by the KPI card, its table and the highlighted-cells export so the three
   can never disagree. A raw row qualifies when EVERY indicator column after "Session Held"
   (beneficiary counts, Td columns and all vaccine columns) carries a numeric 0 - a blank cell
   disqualifies the row. If no "Session Held" column exists, every indicator column after
   "Session Planned" (or, failing that, after Month) is used instead. Month, identifier
   columns and blank-header columns are skipped, and at least one indicator column must exist. */
function dqa_t0_row_all_zero($r, $header, $idxMonth, $iSessH, $iSessP = null){
	if($iSessH !== null) $start = $iSessH + 1;
	elseif($iSessP !== null) $start = $iSessP + 1;
	else $start = ($idxMonth !== null) ? $idxMonth + 1 : 0;
	$hasAny = false;
	for($ci = $start; $ci < count($header); $ci++){
		if($ci === $idxMonth) continue;
		if(dqa_is_non_indicator_col($header[$ci])) continue;
		$v = as_num_or_null(isset($r[$ci]) ? $r[$ci] : null);
		if($v === null) return false;
		if((float)$v != 0.0) return false;
		$hasAny = true;
	}
	return $hasAny;
}

/** Expanded target indicator detection */
function detect_target_indicator($headerOriginal){
	$first = strip_bom($headerOriginal);
	$first = trim((string)$first);
	if($first==='') return null;

	
	/* UWIN-style headers: handle both long labels and short-code second header row (merged with ::) */
	$normAll = normalize_loose_text($first);
	$parts = preg_split('/\s*::\s*/u', $normAll);
	$uwinMap = [
		'children vaccinated with bcg' => 'BCG',
		'bcg' => 'BCG',

		'children vaccinated with hep b' => 'HepB0',
		'hep b' => 'HepB0',
		'hepb0' => 'HepB0',
		'hep b0' => 'HepB0',

		'children vaccinated with opv-1' => 'OPV1',
		'opv-1' => 'OPV1',
		'opv1' => 'OPV1',

		'children vaccinated with opv-3' => 'OPV3',
		'opv-3' => 'OPV3',
		'opv3' => 'OPV3',

		'children vaccinated with penta-1' => 'Penta1',
		'penta-1' => 'Penta1',
		'penta1' => 'Penta1',

		'children vaccinated with penta-3' => 'Penta3',
		'penta-3' => 'Penta3',
		'penta3' => 'Penta3',

		'children vaccinated with mr-1' => 'MR1',
		'mr-1' => 'MR1',
		'mr1' => 'MR1',

		'children vaccinated with mr-2' => 'MR2',
		'mr-2' => 'MR2',
		'mr2' => 'MR2',

		'children vaccinated with rvv1' => 'RVV1',
		'rvv1' => 'RVV1',
		'children vaccinated with rvv2' => 'RVV2',
		'rvv2' => 'RVV2',
		'children vaccinated with rvv3' => 'RVV3',
		'rvv3' => 'RVV3',

		'children vaccinated with fipv-1' => 'IPV1',
		'children vaccinated with fipv1' => 'IPV1',
		'fipv-1' => 'IPV1',
		'fipv1' => 'IPV1',
		'ipv1' => 'IPV1',

		'children vaccinated with fipv2' => 'IPV2',
		'fipv2' => 'IPV2',
		'ipv2' => 'IPV2',

		'children vaccinated with fipv3' => 'IPV3',
		'fipv3' => 'IPV3',
		'ipv3' => 'IPV3',

		'children vaccinated with pcv-1' => 'PCV1',
		'children vaccinated with pcv 1' => 'PCV1',
		'pcv-1' => 'PCV1',
		'pcv1' => 'PCV1',

		'children vaccinated with pcv 2' => 'PCV2',
		'children vaccinated with pcv-2' => 'PCV2',
		'pcv 2' => 'PCV2',
		'pcv2' => 'PCV2',

		'children vaccinated with pcv booster' => 'PCV Booster',
		'pcv booster' => 'PCV Booster',

		'children vaccinated with dpt booster 1' => 'DPT 1st Booster',
		'dpt booster 1' => 'DPT 1st Booster',
		'dpt 1st booster' => 'DPT 1st Booster',
		'dptbooster1' => 'DPT 1st Booster',
	];
	foreach($parts as $p){
		$p = trim(normalize_loose_text($p));
		if($p==='') continue;
		if(isset($uwinMap[$p])){
			return ['code'=>'','short'=>$uwinMap[$p]];
		}
		// Also try stripping the common prefix
		$p2 = preg_replace('/^children vaccinated with\s+/u','',$p);
		$p2 = trim(normalize_loose_text($p2));
		if($p2!=='' && isset($uwinMap[$p2])){
			return ['code'=>'','short'=>$uwinMap[$p2]];
		}
		// Regex fallback (handles minor spacing/dash variations)
		if(preg_match('/\bopv\s*-\s*1\b/u',$p) || preg_match('/\bopv1\b/u',$p)) return ['code'=>'','short'=>'OPV1'];
		if(preg_match('/\bopv\s*-\s*3\b/u',$p) || preg_match('/\bopv3\b/u',$p)) return ['code'=>'','short'=>'OPV3'];
		if(preg_match('/\bpenta\s*-\s*1\b/u',$p) || preg_match('/\bpenta1\b/u',$p)) return ['code'=>'','short'=>'Penta1'];
		if(preg_match('/\bpenta\s*-\s*3\b/u',$p) || preg_match('/\bpenta3\b/u',$p)) return ['code'=>'','short'=>'Penta3'];
		if(preg_match('/\bmr\s*-\s*1\b/u',$p) || preg_match('/\bmr1\b/u',$p)) return ['code'=>'','short'=>'MR1'];
		if(preg_match('/\bmr\s*-\s*2\b/u',$p) || preg_match('/\bmr2\b/u',$p)) return ['code'=>'','short'=>'MR2'];
		if(preg_match('/\bbcg\b/u',$p)) return ['code'=>'','short'=>'BCG'];
		if(preg_match('/\bhep\s*b\b/u',$p) || preg_match('/\bhepb0\b/u',$p)) return ['code'=>'','short'=>'HepB0'];
		if(preg_match('/\bpcv\b.*\bbooster\b/u',$p)) return ['code'=>'','short'=>'PCV Booster'];
		if(preg_match('/\bdpt\b.*\bbooster\b.*\b1\b/u',$p)) return ['code'=>'','short'=>'DPT 1st Booster'];
	}


	/* 1) legacy-style numeric codes (legacy) */
	$targets = [
		['code'=>'9.1.2.','short'=>'BCG'],
		['code'=>'9.1.3.','short'=>'Penta1'],
		['code'=>'9.1.5.','short'=>'Penta3'],
		['code'=>'9.1.7.','short'=>'OPV1'],
		['code'=>'9.1.9.','short'=>'OPV3'],
		['code'=>'9.2.2.','short'=>'MR1'],
		['code'=>'9.4.1.','short'=>'MR2'],
		['code'=>'9.1.13.','short'=>'RVV1'],
		['code'=>'9.1.14.','short'=>'RVV2'],
		['code'=>'9.1.15.','short'=>'RVV3'],
		['code'=>'9.1.11.','short'=>'IPV1'],
		['code'=>'9.1.12.','short'=>'IPV2'],
		['code'=>'9.3.3.','short'=>'IPV3'],
		['code'=>'9.2.3.','short'=>'PCV1'],
		['code'=>'9.2.1.','short'=>'PCV2'],
		['code'=>'9.2.4.','short'=>'PCV Booster'],
		['code'=>'9.1.10.','short'=>'HepB0'],
		['code'=>'9.4.2.','short'=>'DPT 1st Booster'],
	];
	foreach($targets as $t){
		$code = rtrim($t['code'], '.');
		$codePattern = preg_quote($code, '/');
		$pattern = '/^\s*'.$codePattern.'\.?\s*(?:::{0,1}|:|-|—)?\s*/u';
		if(preg_match($pattern, $first)){
			return ['code'=>$t['code'],'short'=>$t['short']];
		}
	}

	/* 2) UWIN-style text headers (no numeric codes)
	   Return the SAME structure used elsewhere: ['code'=>..., 'short'=>...] */
	$low = normalize_loose_text($first);
// Child vaccines
	if(preg_match('/\bchildren\b.*\bvaccinated\b.*\bbcg\b/u', $low)) return ['code'=>'','short'=>'BCG'];

	// Hep B (UWIN often labels as "Hep B" rather than "HepB0" - sometimes exports as "HepB0")
	if(preg_match('/\bhepb0\b/u', $low) || preg_match('/\bhep\s*[- ]?b\s*0\b/u', $low)) return ['code'=>'','short'=>'HepB0'];
	if(preg_match('/\bhep\s*[- ]?b\b/u', $low) || preg_match('/\bhep\s*b\b/u', $low)) return ['code'=>'','short'=>'HepB0'];

	// OPV
	if(preg_match('/\bopv\s*[- ]?\s*0\b/u', $low)) return ['code'=>'','short'=>'OPV0'];
	if(preg_match('/\bopv\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'OPV1'];
	if(preg_match('/\bopv\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'OPV2'];
	if(preg_match('/\bopv\s*[- ]?\s*3\b/u', $low)) return ['code'=>'','short'=>'OPV3'];
	if(preg_match('/\bopv\b.*\bbooster\b/u', $low)) return ['code'=>'','short'=>'OPV Booster'];

	// Penta
	if(preg_match('/\bpenta\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'Penta1'];
	if(preg_match('/\bpenta\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'Penta2'];
	if(preg_match('/\bpenta\s*[- ]?\s*3\b/u', $low)) return ['code'=>'','short'=>'Penta3'];

	// RVV
	if(preg_match('/\brvv\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'RVV1'];
	if(preg_match('/\brvv\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'RVV2'];
	if(preg_match('/\brvv\s*[- ]?\s*3\b/u', $low)) return ['code'=>'','short'=>'RVV3'];

	// IPV / fIPV (UWIN: fIPV-1, FIPV2, etc.)
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'IPV1'];
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'IPV2'];
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*3\b/u', $low)) return ['code'=>'','short'=>'IPV3'];

	// PCV
	if(preg_match('/\bpcv\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'PCV1'];
	if(preg_match('/\bpcv\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'PCV2'];
	if(preg_match('/\bpcv\b.*\bbooster\b/u', $low)) return ['code'=>'','short'=>'PCV Booster'];

	// MR
	if(preg_match('/\bmr\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'MR1'];
	if(preg_match('/\bmr\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'MR2'];

	// Optional (kept for completeness)
	if(preg_match('/\bje\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'JE1'];
	if(preg_match('/\bje\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'JE2'];

	// DPT / boosters
	if(preg_match('/\bdpt\s*[- ]?\s*1\b/u', $low)) return ['code'=>'','short'=>'DPT1'];
	if(preg_match('/\bdpt\s*[- ]?\s*2\b/u', $low)) return ['code'=>'','short'=>'DPT2'];
	if(preg_match('/\bdpt\s*[- ]?\s*3\b/u', $low)) return ['code'=>'','short'=>'DPT3'];
	if(preg_match('/\bdpt\b.*\bbooster\b.*\b1\b/u', $low)) return ['code'=>'','short'=>'DPT 1st Booster'];
	if(preg_match('/\bdpt\b.*\bbooster\b.*\b2\b/u', $low)) return ['code'=>'','short'=>'DPT Booster 2'];

	// Other
	if(preg_match('/\bmmr\b/u', $low)) return ['code'=>'','short'=>'MMR'];
	if(preg_match('/\btyphoid\b/u', $low)) return ['code'=>'','short'=>'Typhoid'];

	return null;
}



/** Short name for any indicator column (after Month) */
function indicator_short_from_header($headerOriginal){
	$h = strip_bom(trim((string)$headerOriginal));
	$low = normalize_loose_text($h);
	// First, try the explicit mapping (gives canonical short names like HepB0, PCV Booster, DPT 1st Booster)
	$det = detect_target_indicator($h);
	if($det !== null && isset($det['short'])) return $det['short'];
/* -------- UWIN / UWIN style headers (no numeric codes) --------
	   Map common vaccine/indicator column titles to the SAME short names
	   used throughout this tool (Dropouts/Outliers/Inconsistencies defaults). */

	// Vaccination counts from UWIN exports (e.g., "Children vaccinated with OPV-1")
	// Use word-boundary patterns to avoid collisions (e.g., MMR vs MR).
	if(preg_match('/\bchildren\b.*\bvaccinated\b.*\bbcg\b/u', $low) || preg_match('/\bbcg\b/u', $low)) return 'BCG';

	// Penta
	if(preg_match('/\bpenta\s*[- ]?\s*1\b/u', $low)) return 'Penta1';
	if(preg_match('/\bpenta\s*[- ]?\s*2\b/u', $low)) return 'Penta2';
	if(preg_match('/\bpenta\s*[- ]?\s*3\b/u', $low)) return 'Penta3';

	// OPV
	if(preg_match('/\bopv\s*[- ]?\s*0\b/u', $low)) return 'OPV0';
	if(preg_match('/\bopv\s*[- ]?\s*1\b/u', $low)) return 'OPV1';
	if(preg_match('/\bopv\s*[- ]?\s*2\b/u', $low)) return 'OPV2';
	if(preg_match('/\bopv\s*[- ]?\s*3\b/u', $low)) return 'OPV3';
	if(preg_match('/\bopv\b.*\bbooster\b/u', $low)) return 'OPV Booster';

	// MR
	if(preg_match('/\bmr\s*[- ]?\s*1\b/u', $low)) return 'MR1';
	if(preg_match('/\bmr\s*[- ]?\s*2\b/u', $low)) return 'MR2';

	// RVV
	if(preg_match('/\brvv\s*[- ]?\s*1\b/u', $low)) return 'RVV1';
	if(preg_match('/\brvv\s*[- ]?\s*2\b/u', $low)) return 'RVV2';
	if(preg_match('/\brvv\s*[- ]?\s*3\b/u', $low)) return 'RVV3';

	// IPV / fIPV (normalize to IPV1/2/3 used by the tool)
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*1\b/u', $low)) return 'IPV1';
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*2\b/u', $low)) return 'IPV2';
	if(preg_match('/\b(f?ipv)\s*[- ]?\s*3\b/u', $low)) return 'IPV3';

	// PCV
	if(preg_match('/\bpcv\s*[- ]?\s*1\b/u', $low)) return 'PCV1';
	if(preg_match('/\bpcv\s*[- ]?\s*2\b/u', $low)) return 'PCV2';
	if(preg_match('/\bpcv\b.*\bbooster\b/u', $low)) return 'PCV Booster';

	// JE
	if(preg_match('/\bje\s*[- ]?\s*1\b/u', $low)) return 'JE1';
	if(preg_match('/\bje\s*[- ]?\s*2\b/u', $low)) return 'JE2';

	// DPT / boosters
	if(preg_match('/\bdpt\s*[- ]?\s*1\b/u', $low)) return 'DPT1';
	if(preg_match('/\bdpt\s*[- ]?\s*2\b/u', $low)) return 'DPT2';
	if(preg_match('/\bdpt\s*[- ]?\s*3\b/u', $low)) return 'DPT3';
	if(preg_match('/\bdpt\b.*\bbooster\b.*\b1\b/u', $low)) return 'DPT 1st Booster';
	if(preg_match('/\bdpt\b.*\bbooster\b.*\b2\b/u', $low)) return 'DPT Booster 2';

	// Hep B (keep simple)
	if(preg_match('/\bhep\s*b\b/u', $low) || preg_match('/\bhep\s*[- ]?b\b/u', $low)) return 'HepB';

	// Other named vaccines (keep readable)
	if(preg_match('/\bmmr\b/u', $low)) return 'MMR';
	if(preg_match('/\btyphoid\b/u', $low)) return 'Typhoid';

	/* -------- Original logic (code-based UWIN headers etc.) -------- */

	// Known target codes
	$det = detect_target_indicator($h);
	if($det !== null && isset($det['short'])) return $det['short'];

	// Fully immunized children patterns (Male/Female/Total)
	if(str_contains($low, 'fully immunized') || str_contains($low, 'fully immunised') || str_contains($low, 'fully immuniz')){
		if(str_contains($low, 'male')) return 'FIC-M';
		if(str_contains($low, 'female')) return 'FIC-F';
		if(str_contains($low, 'total')) return 'FIC-Total';
	}

	// Try to use code token as fallback short
	if(preg_match('/^\s*([0-9]+(?:\.[0-9]+)+(?:\.[a-z])?)\s*/ui', $h, $m)){
		$code = $m[1];
		return strtoupper($code);
	}

	// Fallback: use first 12 non-space chars
	$tok = preg_replace('/\s+/',' ', $h);
	$tok = trim($tok);
	if($tok==='') return 'IND';
	$tok = preg_replace('/[^A-Za-z0-9]+/','', $tok);
	if($tok==='') return 'IND';
	return substr($tok, 0, 12);
}


/** Flexible header finder by exact code prefix OR header text fallback */
function find_index_by_code($headers, $code){
	$codeLow = normalize_header(trim((string)$code));
	if(!preg_match('/\d+\.\d+/', $codeLow)){
		$norm = [];
		foreach($headers as $h){ $norm[] = normalize_header($h); }
		$needle = normalize_header($codeLow);
		foreach($norm as $i=>$h){ if($h === $needle) return $i; }
		foreach($norm as $i=>$h){ if(str_contains($h, $needle)) return $i; }
		return null;
	}
	$code = rtrim((string)$code,'.');
	$pat = '/^\s*'.preg_quote($code,'/').'\.?\s*(?:::{0,1}|:|-|—)?\s*/ui';
	foreach($headers as $i=>$h){
		if(preg_match($pat, strip_bom(trim((string)$h)))) return $i;
	}
	return null;
}

/* -------------------- Utilities -------------------- */
function array_search_first($normHeader,$candidates){
	foreach($candidates as $cand){
		$cand = normalize_header($cand);
		foreach($normHeader as $i=>$h){
			if($h===$cand) return $i;
		}
	}
	return null;
}

/* ---- (added) helpers for the new indicators + Y/N legend ----
   dqa_fic_indices()     : columns of "fully immunized" Male / Female / Total
                           (FIC>MR1 uses Male+Female; Total only when one is missing).
   dqa_typhoid_indices() : every column after Month whose header contains "typhoid".
   dqa_yn_note()         : legend shown under every Y/N matrix (Y = no issue,
                           N = issue found) with the KPI-specific meaning. */
function dqa_fic_indices($header, $idxMonth){
	$out = array('m'=>null,'f'=>null,'t'=>null);
	if($idxMonth===null) return $out;
	for($ci=$idxMonth+1;$ci<count($header);$ci++){
		$hl = normalize_header($header[$ci]);
		if(strpos($hl,'fully immuni')===false) continue;
		if(preg_match('/\bfemale\b/u',$hl)){ if($out['f']===null) $out['f']=$ci; }
		elseif(preg_match('/\bmale\b/u',$hl)){ if($out['m']===null) $out['m']=$ci; }
		elseif(preg_match('/\btotal\b/u',$hl)){ if($out['t']===null) $out['t']=$ci; }
	}
	return $out;
}
function dqa_typhoid_indices($header, $idxMonth){
	$out = array();
	if($idxMonth===null) return $out;
	for($ci=$idxMonth+1;$ci<count($header);$ci++){
		if(strpos(normalize_header($header[$ci]),'typhoid')!==false) $out[] = $ci;
	}
	return $out;
}
function dqa_yn_note($meaning){
	return "<div class='ynNote'><b>Y</b> (light green) = No issue &nbsp;|&nbsp; <b>N</b> (light red) = Issue found &nbsp;&mdash;&nbsp; ".h($meaning)."</div>";
}
/* ---- (added 2026-10) helpers for the accuracy fixes ----
   dqa_new_upload_id()   : random id given to every successful upload; the results
                           page carries it, so a page whose data was replaced by a
                           later upload (another tab or another DQA tool in the same
                           browser) is detected instead of showing the other data.
   dqa_data_sig()        : fingerprint of the data now held in the session.
   dqa_data_guard($uid)  : null when the page's upload id still matches the session
                           data of THIS tool, otherwise the message to show.
   dqa_months_label()    : "3 months (Apr-26–Jun-26)" for consecutive months, or
                           "2 months (Apr-26, Jun-26)" when months are missing between.
   dqa_coadmin_odd()     : vaccines of a vaccine group (same visit) whose value is the
                           odd one out in a month: blanks are ignored; the group differs
                           when 2 or more reported values are not all equal (a 3-2 split
                           counts); the odd ones are the values other than the most
                           frequent value, or every value when no single value is the
                           most frequent (e.g. 10, 8). */
/* (added 2026-10) unit identity text: case, NBSP and repeated spaces ignored */
function dqa_unit_norm($s){
	$s = strip_bom((string)$s);
	$s = str_replace(array("\xC2\xA0", "Â "), ' ', $s);
	$t = preg_replace('/\s+/u', ' ', trim($s));
	if($t === null) $t = preg_replace('/\s+/', ' ', trim($s)); /* invalid UTF-8 fallback */
	$s = (string)$t;
	return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}
function dqa_new_upload_id(){
	if(function_exists('random_bytes')){
		try { return bin2hex(random_bytes(8)); } catch(Exception $e){ /* fallback below */ }
	}
	return substr(md5(uniqid('', true).mt_rand()), 0, 16);
}
function dqa_data_sig(){
	$fn = isset($_SESSION['file_name']) ? (string)$_SESSION['file_name'] : '';
	$n  = (isset($_SESSION['csv_rows']) && is_array($_SESSION['csv_rows'])) ? count($_SESSION['csv_rows']) : -1;
	$hd = isset($_SESSION['csv_header']) ? serialize($_SESSION['csv_header']) : '';
	return md5($fn.'|'.$n.'|'.$hd);
}
function dqa_data_guard($postedUid){
	$msg = 'The data behind this page was replaced by another upload in this browser (another tab or another DQA tool), so it can no longer be shown or downloaded here. Please upload your file again.';
	if(!isset($_SESSION['dqa_upload_id'], $_SESSION['dqa_upload_tool'], $_SESSION['dqa_upload_sig'])) return $msg;
	if((string)$_SESSION['dqa_upload_tool'] !== 'dqauwin') return $msg;
	$postedUid = (string)$postedUid;
	if($postedUid === '' || $postedUid !== (string)$_SESSION['dqa_upload_id']) return $msg;
	if((string)$_SESSION['dqa_upload_sig'] !== dqa_data_sig()) return $msg;
	return null;
}
function dqa_months_label($keys){
	$keys = array_values(array_unique(array_map('strval', (array)$keys)));
	sort($keys, SORT_STRING);
	$n = count($keys);
	if($n === 0) return '—';
	$lbl = array();
	foreach($keys as $k){ $lbl[] = month_label_from_key_my($k); }
	$word = $n.' month'.($n === 1 ? '' : 's');
	if($n === 1) return $word.' ('.$lbl[0].')';
	$span = months_span_inclusive($keys[0], $keys[$n-1]);
	if($span !== null && (int)$span === $n) return $word.' ('.$lbl[0].'–'.$lbl[$n-1].')';
	return $word.' ('.implode(', ', $lbl).')';
}
function dqa_coadmin_odd($vals){
	$nb = array(); $cnt = array();
	foreach((array)$vals as $vx=>$v){
		if($v === null) continue;
		$k = sprintf('%.10F', (float)$v);
		$nb[$vx] = $k;
		$cnt[$k] = isset($cnt[$k]) ? $cnt[$k] + 1 : 1;
	}
	if(count($nb) < 2 || count($cnt) < 2) return array();
	$max = max($cnt);
	$modes = array();
	foreach($cnt as $k=>$c){ if($c === $max) $modes[] = $k; }
	$out = array();
	foreach($nb as $vx=>$k){
		if(count($modes) > 1 || $k !== $modes[0]) $out[$vx] = true;
	}
	return $out;
}

/* (added 2026-10) month typed for a file without a Month column (or guessed from the file
   name): 2026-07, 2026-7, 2026/07, 202607, 07-2026, 7/2026, Jul-26, Jul 2026, July-2026,
   Sept 26 ... -> "2026-07"; anything else -> null (the upload is then refused with a
   message instead of the file's rows being dropped silently). */
function dqa_uwin_month_input($s){
	$s = trim((string)$s);
	if($s === '') return null;
	$ok = function($y, $m){ return ($y >= 2000 && $y <= 2099 && $m >= 1 && $m <= 12) ? sprintf('%04d-%02d', $y, $m) : null; };
	if(preg_match('/^(\d{4})\s*[-\/_. ]\s*(\d{1,2})$/', $s, $mm)) return $ok((int)$mm[1], (int)$mm[2]);
	if(preg_match('/^(\d{4})(\d{2})$/', $s, $mm)) return $ok((int)$mm[1], (int)$mm[2]);
	if(preg_match('/^(\d{1,2})\s*[-\/_. ]\s*(\d{4})$/', $s, $mm)) return $ok((int)$mm[2], (int)$mm[1]);
	if(preg_match('/^([A-Za-z]{3,9})\.?\s*[-\/_. \']?\s*(\d{2}|\d{4})$/', $s, $mm)){
		$full = array('january','february','march','april','may','june','july','august','september','october','november','december');
		$w = strtolower($mm[1]);
		$m = 0;
		foreach($full as $i=>$fn){
			if($w === substr($fn, 0, 3) || $w === $fn || ($w === 'sept' && $i === 8) || (strlen($w) >= 3 && strpos($fn, $w) === 0)){ $m = $i + 1; break; }
		}
		if($m === 0) return null;
		$y = (int)$mm[2]; if(strlen($mm[2]) === 2) $y += 2000;
		return $ok($y, $m);
	}
	return null;
}
/* (added 2026-10) one session site = LGD Block + Health Facility (or, in the newer format
   without it, the Sub District, never shown) + Sub Center + Session Site Name, compared
   without case/extra-space differences. */
function dqa_uwin_unit_key($r, $iBlock, $iFacOrSub, $iSubCentre, $iSite){
	$g = function($i) use ($r){ return ($i!==null && isset($r[$i])) ? (string)$r[$i] : ''; };
	return dqa_unit_norm($g($iBlock)).'||'.dqa_unit_norm($g($iFacOrSub)).'||'.dqa_unit_norm($g($iSubCentre)).'||'.dqa_unit_norm($g($iSite));
}
/* (added 2026-10) Td columns, also when the export names them "Td-1", "Td - Booster",
   "TD10" ... instead of "Number of Women vaccinated with Td-1" etc. */
function dqa_uwin_find_col_compact($header, $forms){
	foreach((array)$forms as $f){
		foreach($header as $i=>$h){ if(header_compact_key($h) === $f) return $i; }
	}
	return null;
}

/* ==================================================================
   (added 2026-11) WEB PARITY ENGINE - U-WIN
   ------------------------------------------------------------------
   Line-by-line port of the DQA web application's U-WIN analysis, so this
   tool gives the same units, indicators and Overall Score as the web
   application's U-WIN portal for the same files:
     - src/lib/dqa/parseUtils.ts      header / number / period helpers (uwx_*)
     - src/lib/uwin/uploadPeriod.ts   Weekly / Monthly reporting-period rules
     - src/lib/uwin/csvParser.ts      two-row header, period stamping, merge, units
     - src/lib/uwin/computeKpis.ts    every check, at facility / sub center /
                                      session site level (uwx_compute)
     - src/lib/dqa/checkRules.ts, coadmin.ts (dqa_* below, shared with dqahmis.php)
     - src/lib/dqa/weightedScoring.ts U-WIN weights, scoring method v8
   Blank cells stay blank (never read as 0). Names and rules follow the web
   application exactly; only the screens of this tool are its own.
   ================================================================== */

/* ---------- checkRules.ts / coadmin.ts (same code as dqahmis.php) ---------- */
function dqa_mom_change($prev, $curr){
	if($prev === null || $curr === null || $prev < 0) return null;
	$small = (max($prev, $curr) < 10);
	if($prev == 0) return $small ? null : array('pct'=>null, 'fromZero'=>true, 'small'=>false);
	return array('pct'=>round(($curr - $prev) / $prev * 100, 9), 'fromZero'=>false, 'small'=>$small);
}
function dqa_outlier_band($ch){
	if(!empty($ch['fromZero'])) return 'INC_EXT';
	$p = $ch['pct'];
	if($p === null) return null;
	$f = !empty($ch['small']) ? 2 : 1;
	if($p > 100 * $f) return 'INC_EXT';
	if($p >= 50 * $f) return 'INC_MOD';
	if($p >= 25 * $f) return 'INC_LOW';
	if(!empty($ch['small'])) return null;
	if($p <= -75) return 'DROP_EXT';
	if($p <= -50) return 'DROP_MOD';
	if($p <= -25) return 'DROP_LOW';
	return null;
}
function dqa_dropout_pct($from, $to){
	if($from === null || $to === null || $from <= 0) return null;
	return round(($from - $to) / $from * 100, 9);
}
function dqa_dropout_range($pct){
	if($pct === null) return null;
	if($pct >= 20) return 'R20P';
	if($pct >= 10) return 'R11_20';
	if($pct >= 5) return 'R5_10';
	return null;
}
function dqa_later_dose_exceeds($earlier, $later){
	if($earlier === null || $later === null) return null;
	if($earlier <= 0) return ($later >= 10);
	$allowed = (max($earlier, $later) < 10) ? 50 : 25;
	return ($later - $earlier) * 100 > $allowed * $earlier;
}
function dqa_dose_excess_label($earlier, $later){
	if($earlier <= 0) return 'from 0';
	$pct = ($later - $earlier) / $earlier * 100;
	return ($pct > 0 ? '+' : '').number_format($pct, 1, '.', '').'%';
}
/* vaccines of a co-administration group out of range in one period (coadmin.ts coadminAssess) */
function dqa_coadmin_out_of_range($vals){
	$present = array();
	foreach((array)$vals as $vx=>$v){ if($v !== null) $present[$vx] = (float)$v; }
	if(count($present) < 2) return array();
	$cnt = array(); $valOf = array();
	foreach($present as $v){
		$k = sprintf('%.10F', $v);
		$cnt[$k] = isset($cnt[$k]) ? $cnt[$k] + 1 : 1;
		$valOf[$k] = $v;
	}
	$max = max($cnt);
	$modes = array_keys($cnt, $max, true);
	$ref = null;
	if($max > 1 && count($modes) === 1) $ref = $valOf[$modes[0]];
	if($ref === null){ foreach($present as $vx=>$v){ if(stripos(trim((string)$vx), 'penta') === 0){ $ref = $v; break; } } }
	if($ref === null){ foreach($present as $vx=>$v){ if(preg_match('/^mr\s*\d/i', trim((string)$vx))){ $ref = $v; break; } } }
	if($ref === null){
		$s = array_values($present); sort($s); $n = count($s); $mid = (int)floor($n / 2);
		$ref = ($n % 2 === 1) ? $s[$mid] : ($s[$mid - 1] + $s[$mid]) / 2;
	}
	$allowed = ($ref < 10) ? 50 : 25;
	$out = array();
	foreach($present as $vx=>$v){
		$bad = ($ref <= 0) ? ($v >= 10) : (abs($v - $ref) * 100 > $allowed * $ref);
		if($bad) $out[$vx] = true;
	}
	return $out;
}
/* "All periods" totals of a co-administration row (coadmin.ts coadminMatchedTotals) */
function dqa_coadmin_matched_totals($valsByMonth, $vaccines){
	$reported = array();
	foreach($vaccines as $vx){
		foreach($valsByMonth as $row){ if(isset($row[$vx])){ $reported[] = $vx; break; } }
	}
	$tot = array();
	foreach($vaccines as $vx){ $tot[$vx] = null; }
	if(count($reported) < 2){
		foreach($reported as $vx){
			$s = 0;
			foreach($valsByMonth as $row){ if(isset($row[$vx])) $s += $row[$vx]; }
			$tot[$vx] = $s;
		}
		return $tot;
	}
	foreach($valsByMonth as $row){
		$ok = true;
		foreach($reported as $vx){ if(!isset($row[$vx])){ $ok = false; break; } }
		if(!$ok) continue;
		foreach($reported as $vx){ $tot[$vx] = ($tot[$vx] === null ? 0 : $tot[$vx]) + $row[$vx]; }
	}
	return $tot;
}

/* ---------- weightedScoring.ts: U-WIN weights (scoring method v8) ---------- */
function uwx_weight_table($periodCount){
	$t = array();
	$add = function($comp, $grp, $w, $checks) use (&$t){
		foreach($checks as $c){ $t[] = array('id'=>$c[0], 'name'=>$c[1], 'comp'=>$comp, 'grp'=>$grp, 'w'=>$w / count($checks)); }
	};
	$co = array(array('co1','Co-administration — 6 weeks'), array('co2','Co-administration — 10 weeks'), array('co3','Co-administration — 14 weeks'), array('co4','Co-administration — 9 months'), array('co5','Co-administration — 2 years'));
	$add('availability', 'All checks', 100 / 3, array(array('t0','Indicators having 0 values but not blank'), array('t7','Indicators with same values'), array('t9','Zero coverage session')));
	if($periodCount >= 2){
		$add('accuracy', 'Sessions', 100 / 9, array(array('t6','Planned but not held'), array('t8','Avg Beneficiaries per Session < 5')));
		$add('accuracy', 'Outliers', 100 / 9, array(array('t3','Outliers')));
		$add('accuracy', 'Dropouts', 100 / 9, array(array('drop_penta1_penta3','Dropouts — Penta1→Penta3'), array('drop_mr1_mr2','Dropouts — MR1→MR2'), array('drop_penta3_mr1','Dropouts — Penta3→MR1')));
	} else {
		$add('accuracy', 'Sessions', 100 / 3, array(array('t6','Planned but not held'), array('t8','Avg Beneficiaries per Session < 5')));
	}
	$add('consistency', 'Inconsistencies', 50 / 3, array(array('i1','Inconsistencies — Penta3>Penta1'), array('i2','Inconsistencies — MR2>MR1')));
	$add('consistency', 'Co-administration', 50 / 3, $co);
	return $t;
}
/* weighted score (weightedScoring.ts scoreWeighted); $cards = id => ['flagged','eligible','name'] */
function uwx_weighted_score($cards, $den, $periodCount){
	$rows = uwx_weight_table($periodCount);
	$den = ($den > 0) ? $den : 0;
	$gBase = array(); $gRun = array();
	foreach($rows as $i=>$r){
		$c = isset($cards[$r['id']]) ? $cards[$r['id']] : null;
		$run = ($den > 0 && $c !== null && (int)$c['eligible'] > 0);
		if($c !== null && isset($c['name']) && (string)$c['name'] !== '') $rows[$i]['name'] = (string)$c['name'];
		$rows[$i]['flagged'] = ($c !== null) ? (int)$c['flagged'] : null;
		$rows[$i]['eligible'] = ($c !== null) ? (int)$c['eligible'] : 0;
		$rows[$i]['run'] = $run;
		$rows[$i]['score'] = $run ? max(0.0, 100.0 - ((float)$c['flagged'] / $den) * 100.0) : null;
		$rows[$i]['used'] = 0.0;
		$rows[$i]['points'] = null;
		$gk = $r['comp'].'|'.$r['grp'];
		$gBase[$gk] = (isset($gBase[$gk]) ? $gBase[$gk] : 0) + $r['w'];
		if($run) $gRun[$gk] = (isset($gRun[$gk]) ? $gRun[$gk] : 0) + $r['w'];
	}
	$cBase = array(); $cRun = array();
	foreach($gBase as $gk=>$w){
		$parts = explode('|', $gk); $comp = $parts[0];
		$cBase[$comp] = (isset($cBase[$comp]) ? $cBase[$comp] : 0) + $w;
		if(!empty($gRun[$gk])) $cRun[$comp] = (isset($cRun[$comp]) ? $cRun[$comp] : 0) + $w;
	}
	$tRun = 0;
	foreach($cBase as $comp=>$w){ if(!empty($cRun[$comp])) $tRun += $w; }
	$overall = 0.0; $cW = array(); $cP = array();
	foreach($rows as $i=>$r){
		if(!$r['run'] || $tRun <= 0) continue;
		$gk = $r['comp'].'|'.$r['grp'];
		$used = $r['w'] * ($gBase[$gk] / $gRun[$gk]) * ($cBase[$r['comp']] / $cRun[$r['comp']]) * (100 / $tRun);
		$pts = $used * $r['score'] / 100;
		$rows[$i]['used'] = $used;
		$rows[$i]['points'] = $pts;
		$overall += $pts;
		$cW[$r['comp']] = (isset($cW[$r['comp']]) ? $cW[$r['comp']] : 0) + $used;
		$cP[$r['comp']] = (isset($cP[$r['comp']]) ? $cP[$r['comp']] : 0) + $pts;
	}
	$comps = array(); $compWeights = array();
	foreach(array('availability', 'accuracy', 'consistency') as $comp){
		$comps[$comp] = !empty($cW[$comp]) ? round($cP[$comp] * 100 / $cW[$comp], 9) : null;
		$compWeights[$comp] = !empty($cW[$comp]) ? $cW[$comp] : 0;
	}
	return array('overall'=>($tRun > 0 ? round($overall, 9) : null), 'components'=>$comps, 'componentWeights'=>$compWeights, 'checks'=>$rows, 'periodCount'=>(int)$periodCount);
}

/* ---------- parseUtils.ts ---------- */
function uwx_strip_bom($s){ $s = (string)$s; return (strncmp($s, "\xEF\xBB\xBF", 3) === 0) ? substr($s, 3) : $s; }
/* String.prototype.trim (Unicode white space and the BOM) */
function uwx_trim($s){
	$s = (string)$s;
	$t = preg_replace('/^[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+|[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+$/u', '', $s);
	return ($t === null) ? trim($s) : $t;
}
function uwx_lower($s){ return function_exists('mb_strtolower') ? mb_strtolower((string)$s, 'UTF-8') : strtolower((string)$s); }
function uwx_loose($s){
	$v = uwx_strip_bom((string)$s);
	$v = str_replace("\xC2\xA0", ' ', $v);
	$u = preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{206F}]/u', '', $v);
	if($u !== null){
		$v = preg_replace('/[\x{2010}-\x{2015}\x{2212}\x{FE58}\x{FE63}\x{FF0D}]/u', '-', $u);
	}
	$v = preg_replace('/[\r\n\t]+/', ' ', $v);
	$v = uwx_trim($v);
	$w = preg_replace('/[\s\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+/u', ' ', $v);
	if($w === null) $w = preg_replace('/\s+/', ' ', $v);
	return uwx_lower($w);
}
function uwx_norm($s){ return uwx_loose($s); }
function uwx_compact($s){ return preg_replace('/[^a-z0-9]+/', '', uwx_norm($s)); }
function uwx_fac_key($s){ $s = str_replace("\xC2\xA0", ' ', uwx_strip_bom((string)$s)); return uwx_lower(uwx_trim($s)); }
function uwx_ownership($v){
	$s = uwx_lower(uwx_trim($v));
	if($s === '') return '';
	if(strpos($s, 'pub') === 0 || strpos($s, 'government') !== false || strpos($s, 'govt') !== false) return 'Public';
	if(strpos($s, 'pri') === 0 || strpos($s, 'pvt') !== false || strpos($s, 'private') !== false) return 'Private';
	return mb_strtoupper(mb_substr($s, 0, 1, 'UTF-8'), 'UTF-8').mb_substr($s, 1, null, 'UTF-8');
}
function uwx_ru($v){
	$s = uwx_lower(uwx_trim($v));
	if($s === '') return '';
	if(strpos($s, 'rur') === 0) return 'Rural';
	if(strpos($s, 'urb') === 0) return 'Urban';
	return mb_strtoupper(mb_substr($s, 0, 1, 'UTF-8'), 'UTF-8').mb_substr($s, 1, null, 'UTF-8');
}
/* asNumOrNull: blank / NA / N/A / null / - and text without a number = blank */
function uwx_num($v){
	if($v === null) return null;
	$s = uwx_trim(str_replace("\xC2\xA0", ' ', uwx_strip_bom((string)$v)));
	if($s === '') return null;
	$low = uwx_lower($s);
	if($low === 'na' || $low === 'n/a' || $low === 'null' || $low === '-') return null;
	$s = str_replace(',', '', $s);
	$s = preg_replace('/(?<=\d)\s+(?=\d)/', '', $s);
	if(preg_match('/^[+-]?\d+(?:\.\d+)?$/', $s)) return (float)$s;
	if(!preg_match('/[+-]?\d+(?:\.\d+)?/', $s, $m)) return null;
	return (float)$m[0];
}
function uwx_array_search_first($normHeaders, $candidates){
	foreach($candidates as $cand){
		$cn = uwx_norm($cand);
		foreach($normHeaders as $i=>$h){ if($h === $cn) return $i; }
	}
	return null;
}
function uwx_find_contains_any($rawHeader, $needles){
	$norm = array(); foreach($rawHeader as $h){ $norm[] = uwx_norm($h); }
	foreach($needles as $needle){
		$nn = uwx_norm($needle);
		foreach($norm as $i=>$h){
			if($h === $nn) return $i;
			if($nn !== '' && strpos($h, $nn) !== false) return $i;
		}
	}
	return null;
}
function uwx_find_block($rawHeader){
	$norm = array(); $compact = array();
	foreach($rawHeader as $h){ $norm[] = uwx_norm($h); $compact[] = uwx_compact($h); }
	foreach(array('lgd block name','lgd_block_name','lgd block','lgdblockname') as $c){
		$cn = uwx_norm($c); $cc = uwx_compact($c);
		foreach($norm as $i=>$h){ if($h === $cn || $compact[$i] === $cc) return $i; }
	}
	foreach($compact as $i=>$c){ if(strpos($c, 'lgdblockname') !== false || strpos($c, 'lgdblock') !== false) return $i; }
	foreach($norm as $i=>$h){ if(strpos($h, 'lgd') !== false && strpos($h, 'block') !== false) return $i; }
	foreach(array('block name','health block name','block') as $c){
		$cn = uwx_norm($c); $cc = uwx_compact($c);
		foreach($norm as $i=>$h){ if($h === $cn || $compact[$i] === $cc) return $i; }
	}
	foreach($norm as $i=>$h){ if(strpos($h, 'block') !== false) return $i; }
	return null;
}
function uwx_find_facility($rawHeader){
	$norm = array(); $compact = array();
	foreach($rawHeader as $h){ $norm[] = uwx_norm($h); $compact[] = uwx_compact($h); }
	foreach(array('health facility name','health_facility_name','facility name','facility_name') as $c){
		$cn = uwx_norm($c); $cc = uwx_compact($c);
		foreach($norm as $i=>$h){ if($h === $cn || $compact[$i] === $cc) return $i; }
	}
	foreach($norm as $i=>$h){ if(strpos($h, 'facility') !== false && strpos($h, 'name') !== false) return $i; }
	return null;
}
function uwx_find_month($rawHeader){
	$norm = array(); foreach($rawHeader as $h){ $norm[] = uwx_norm($h); }
	foreach(array('month','reporting month','month name') as $c){
		foreach($norm as $i=>$h){ if($h === $c) return $i; }
	}
	foreach($norm as $i=>$h){ if(strpos($h, 'month') !== false) return $i; }
	return null;
}
function uwx_find_by_code($headers, $code){
	if(preg_match('/\d+\.\d+/', $code)){
		$esc = str_replace('.', '\\.', rtrim($code, '.'));
		$pat = '/^\s*'.$esc.'\.?\s*(?::{1,2}|-|\x{2014})?\s*/ui';
		foreach($headers as $i=>$h){ if(preg_match($pat, uwx_strip_bom(uwx_trim($h)))) return $i; }
		return null;
	}
	$needle = uwx_norm($code);
	foreach($headers as $i=>$h){ if(uwx_norm($h) === $needle) return $i; }
	foreach($headers as $i=>$h){ if(strpos(uwx_norm($h), $needle) !== false) return $i; }
	return null;
}
function uwx_textual_short($headerOriginal){
	static $shorts = array('bcg'=>'BCG','hepb0'=>'HepB0','hepb'=>'HepB0','opv0'=>'OPV0','opv1'=>'OPV1','opv2'=>'OPV2','opv3'=>'OPV3',
		'opvbooster'=>'OPV Booster','penta1'=>'Penta1','penta2'=>'Penta2','penta3'=>'Penta3','rvv1'=>'RVV1','rvv2'=>'RVV2','rvv3'=>'RVV3',
		'ipv1'=>'IPV1','ipv2'=>'IPV2','ipv3'=>'IPV3','fipv1'=>'IPV1','fipv2'=>'IPV2','fipv3'=>'IPV3','pcv1'=>'PCV1','pcv2'=>'PCV2',
		'pcvbooster'=>'PCV Booster','mr1'=>'MR1','mr2'=>'MR2','je1'=>'JE1','je2'=>'JE2','dpt1'=>'DPT1','dpt2'=>'DPT2','dpt3'=>'DPT3',
		'dpt1stbooster'=>'DPT 1st Booster','dptbooster1'=>'DPT 1st Booster','dptb1'=>'DPT 1st Booster','dptbooster2'=>'DPT Booster 2',
		'dptb2'=>'DPT Booster 2','mmr'=>'MMR','typhoid'=>'Typhoid');
	$original = uwx_trim(uwx_strip_bom($headerOriginal));
	if($original === '') return null;
	$segs = preg_split('/\s*::\s*/u', $original);
	if($segs === false) $segs = array($original);
	foreach($segs as $segment){
		$part = uwx_loose($segment);
		if($part === '') continue;
		$compact = uwx_compact($part);
		$np = preg_replace('/^children vaccinated with\s+/u', '', $part);
		$compactNoPrefix = uwx_compact($np === null ? $part : $np);
		if(isset($shorts[$compact])) return $shorts[$compact];
		if(isset($shorts[$compactNoPrefix])) return $shorts[$compactNoPrefix];
		$t = function($re) use ($part){ return (bool)preg_match($re, $part); };
		if($t('/\bbcg\b/u')) return 'BCG';
		if($t('/\bhepb0\b/u') || $t('/\bhep\s*[- ]?b\s*0\b/u')) return 'HepB0';
		if($t('/\bchildren\b.*\bvaccinated\b.*\bhep\s*[- ]?b\b/u') || $t('/\bhep\s*[- ]?b\b/u')) return 'HepB0';
		if($t('/\bopv\b.*\bbooster\b/u')) return 'OPV Booster';
		if($t('/\bopv\s*[- ]?\s*0\b/u')) return 'OPV0';
		if($t('/\bopv\s*[- ]?\s*1\b/u')) return 'OPV1';
		if($t('/\bopv\s*[- ]?\s*2\b/u')) return 'OPV2';
		if($t('/\bopv\s*[- ]?\s*3\b/u')) return 'OPV3';
		if($t('/\bpenta\s*[- ]?\s*1\b/u')) return 'Penta1';
		if($t('/\bpenta\s*[- ]?\s*2\b/u')) return 'Penta2';
		if($t('/\bpenta\s*[- ]?\s*3\b/u')) return 'Penta3';
		if($t('/\brvv\s*[- ]?\s*1\b/u')) return 'RVV1';
		if($t('/\brvv\s*[- ]?\s*2\b/u')) return 'RVV2';
		if($t('/\brvv\s*[- ]?\s*3\b/u')) return 'RVV3';
		if($t('/\b(?:f?ipv)\s*[- ]?\s*1\b/u')) return 'IPV1';
		if($t('/\b(?:f?ipv)\s*[- ]?\s*2\b/u')) return 'IPV2';
		if($t('/\b(?:f?ipv)\s*[- ]?\s*3\b/u')) return 'IPV3';
		if($t('/\bpcv\b.*\bbooster\b/u')) return 'PCV Booster';
		if($t('/\bpcv\s*[- ]?\s*1\b/u')) return 'PCV1';
		if($t('/\bpcv\s*[- ]?\s*2\b/u')) return 'PCV2';
		if($t('/\bmr\s*[- ]?\s*1\b/u')) return 'MR1';
		if($t('/\bmr\s*[- ]?\s*2\b/u')) return 'MR2';
		if($t('/\bje\s*[- ]?\s*1(?:st)?\b/u')) return 'JE1';
		if($t('/\b(?:je|japanese encephalitis)\b.*\b1st\s+dose\b/u')) return 'JE1';
		if($t('/\bje\s*[- ]?\s*2(?:nd)?\b/u')) return 'JE2';
		if($t('/\b(?:je|japanese encephalitis)\b.*\b2nd\s+dose\b/u')) return 'JE2';
		if($t('/\bdpt\b.*\bbooster\b.*\b1\b/u')) return 'DPT 1st Booster';
		if($t('/\bdpt\b.*\bbooster\b.*\b2\b/u')) return 'DPT Booster 2';
		if($t('/\bdpt\s*[- ]?\s*1\b/u')) return 'DPT1';
		if($t('/\bdpt\s*[- ]?\s*2\b/u')) return 'DPT2';
		if($t('/\bdpt\s*[- ]?\s*3\b/u')) return 'DPT3';
		if($t('/\bmmr\b/u')) return 'MMR';
		if($t('/\btyphoid\b/u')) return 'Typhoid';
	}
	return null;
}
/* detectTargetIndicator: array('code'=>..,'short'=>..) or null */
function uwx_detect_target($headerOriginal){
	static $targets = array(array('9.1.2','BCG'),array('9.1.3','Penta1'),array('9.1.4','Penta2'),array('9.1.5','Penta3'),array('9.1.7','OPV1'),
		array('9.1.8','OPV2'),array('9.1.9','OPV3'),array('9.2.2','MR1'),array('9.4.1','MR2'),array('9.1.13','RVV1'),array('9.1.14','RVV2'),
		array('9.1.15','RVV3'),array('9.1.11','IPV1'),array('9.1.12','IPV2'),array('9.2.1','IPV3'),array('9.1.16','PCV1'),array('9.2.3','JE1'),
		array('9.4.4','JE2'),array('9.1.17','PCV2'),array('9.2.4','PCV Booster'),array('9.1.10','HepB0'),array('9.4.2','DPT 1st Booster'));
	$h = uwx_trim(uwx_strip_bom($headerOriginal));
	if($h === '') return null;
	if(preg_match('/\bdelayed\b/u', uwx_loose($h))) return null;
	$ts = uwx_textual_short($h);
	if($ts !== null) return array('code'=>'', 'short'=>$ts);
	foreach($targets as $t){
		$esc = str_replace('.', '\\.', $t[0]);
		if(preg_match('/^\s*'.$esc.'\.?\s*(?::{1,2}|-|\x{2014})?\s*/ui', $h)) return array('code'=>$t[0], 'short'=>$t[1]);
	}
	return null;
}
/* buildTargetIndicatorMap: a column whose own text names the vaccine outranks a code match; earliest wins ties */
function uwx_target_map($header, $startIdx){
	$map = array(); $tier = array(); $indices = array();
	for($i = $startIdx; $i < count($header); $i++){
		$det = uwx_detect_target($header[$i]);
		if(!$det) continue;
		$indices[] = $i;
		$t = ($det['code'] === '') ? 2 : 1;
		if(!isset($map[$det['short']]) || $t > $tier[$det['short']]){ $map[$det['short']] = $i; $tier[$det['short']] = $t; }
	}
	return array('map'=>$map, 'indices'=>$indices);
}
function uwx_short_from_header($headerOriginal){
	$h = uwx_strip_bom(uwx_trim($headerOriginal));
	$low = uwx_loose($h);
	$det = uwx_detect_target($h);
	if($det) return $det['short'];
	if(strpos($low, 'fully immuniz') !== false || strpos($low, 'fully immunis') !== false){
		if(strpos($low, 'female') !== false) return 'FIC-F';
		if(strpos($low, 'male') !== false) return 'FIC-M';
		if(strpos($low, 'total') !== false) return 'FIC-Total';
	}
	if(preg_match('/^\s*([0-9]+(?:\.[0-9]+)+(?:\.[a-z])?)\s*/i', $h, $m)) return strtoupper($m[1]);
	$tok = preg_replace('/[^A-Za-z0-9]+/', '', preg_replace('/\s+/u', '', $h));
	if($tok !== '' && $tok !== null) return substr($tok, 0, 12);
	return 'IND';
}
function uwx_display_block($b){ $b = uwx_trim($b); return ($b === '') ? 'Unknown block' : $b; }
function uwx_safe_key($s){
	$s = preg_replace('/[\x{2192}\x{2014}\x{2013}><:\/\\\\|?*"\',;()\[\]{}]/u', '_', (string)$s);
	$s = preg_replace('/\s+/u', '_', $s);
	$s = preg_replace('/[^A-Za-z0-9_-]+/', '_', $s);
	$s = strtolower(preg_replace('/^_+|_+$/', '', $s));
	return ($s === '') ? 'key' : $s;
}

/* ---------- reporting periods (parseUtils.ts) ---------- */
function uwx_is_month_key($k){ return (bool)preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', trim((string)$k)); }
function uwx_iso_day_ok($d){ return (bool)preg_match('/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/', (string)$d); }
function uwx_parse_range($k){
	if(!preg_match('/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/', trim((string)$k), $m)) return null;
	if(!uwx_iso_day_ok($m[1]) || !uwx_iso_day_ok($m[2])) return null;
	return array('from'=>$m[1], 'to'=>$m[2]);
}
function uwx_is_range_key($k){ return (bool)preg_match('/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/', trim((string)$k)); }
function uwx_month_end_day($ym){
	$p = explode('-', (string)$ym);
	if(count($p) < 2 || (int)$p[0] <= 0 || (int)$p[1] <= 0) return $ym;
	return sprintf('%s-%02d', $ym, (int)gmdate('t', gmmktime(0, 0, 0, (int)$p[1], 1, (int)$p[0])));
}
function uwx_make_period_key($from, $to){
	$s = trim((string)$from); $e = trim((string)$to);
	if(!uwx_iso_day_ok($s) || !uwx_iso_day_ok($e)) return null;
	if(strcmp($s, $e) > 0) return null;
	$ym = substr($s, 0, 7);
	if(substr($e, 0, 7) === $ym && substr($s, -3) === '-01' && $e === uwx_month_end_day($ym)) return $ym;
	return $s.'..'.$e;
}
function uwx_period_day_range($k){
	$r = uwx_parse_range($k);
	if($r) return $r;
	$ym = trim((string)$k);
	if(!uwx_is_month_key($ym)) return null;
	return array('from'=>$ym.'-01', 'to'=>uwx_month_end_day($ym));
}
function uwx_next_month($ym){ $p = explode('-', $ym); $y = (int)$p[0]; $m = (int)$p[1]; return ($m === 12) ? sprintf('%04d-01', $y + 1) : sprintf('%04d-%02d', $y, $m + 1); }
function uwx_period_months($k){
	$r = uwx_period_day_range($k);
	if(!$r) return array();
	$end = substr($r['to'], 0, 7); $out = array(); $cur = substr($r['from'], 0, 7);
	for($g = 0; strcmp($cur, $end) <= 0 && $g < 240; $g++){ $out[] = $cur; $cur = uwx_next_month($cur); }
	return $out;
}
function uwx_utc_day($iso){ $p = explode('-', $iso); return gmmktime(0, 0, 0, (int)$p[1], (int)$p[2], (int)$p[0]); }
function uwx_periods_consecutive($a, $b){
	$x = uwx_period_day_range($a); $y = uwx_period_day_range($b);
	if(!$x || !$y) return false;
	return (uwx_utc_day($y['from']) - uwx_utc_day($x['to'])) === 86400;
}
function uwx_days_span($from, $to){
	if(!uwx_iso_day_ok($from) || !uwx_iso_day_ok($to)) return null;
	return (int)round((uwx_utc_day($to) - uwx_utc_day($from)) / 86400) + 1;
}
function uwx_months_span($a, $b){
	$x = explode('-', $a); $y = explode('-', $b);
	if(count($x) !== 2 || count($y) !== 2) return null;
	return ((int)$y[0] - (int)$x[0]) * 12 + ((int)$y[1] - (int)$x[1]) + 1;
}
function uwx_mon3($iso){ $n = array('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'); $i = (int)substr($iso, 5, 2) - 1; return isset($n[$i]) ? $n[$i] : substr($iso, 5, 2); }
function uwx_monlong($iso){ $n = array('January','February','March','April','May','June','July','August','September','October','November','December'); $i = (int)substr($iso, 5, 2) - 1; return isset($n[$i]) ? $n[$i] : substr($iso, 5, 2); }
function uwx_dom($iso){ return (int)substr($iso, 8, 2); }
/* monthShortLabel: "Apr" / "1-7 Apr" */
function uwx_month_short_label($ym){
	$r = uwx_parse_range($ym);
	if($r){
		if(substr($r['from'], 0, 7) === substr($r['to'], 0, 7)) return uwx_dom($r['from']).'-'.uwx_dom($r['to']).' '.uwx_mon3($r['from']);
		return uwx_dom($r['from']).' '.uwx_mon3($r['from']).'-'.uwx_dom($r['to']).' '.uwx_mon3($r['to']);
	}
	$p = explode('-', (string)$ym);
	if(count($p) !== 2) return $ym;
	$m = (int)$p[1] - 1;
	if($m < 0 || $m > 11) return $ym;
	return uwx_mon3('0000-'.$p[1]);
}
/* monthYearLabel: "Apr-26" / "1-7 Apr 26" */
function uwx_month_year_label($ym){
	$r = uwx_parse_range($ym);
	if($r){
		$f = $r['from']; $t = $r['to'];
		if(substr($f, 0, 7) === substr($t, 0, 7)) return uwx_dom($f).'-'.uwx_dom($t).' '.uwx_mon3($f).' '.substr($f, 2, 2);
		if(substr($f, 0, 4) === substr($t, 0, 4)) return uwx_dom($f).' '.uwx_mon3($f).' - '.uwx_dom($t).' '.uwx_mon3($t).' '.substr($t, 2, 2);
		return uwx_dom($f).' '.uwx_mon3($f).' '.substr($f, 2, 2).' - '.uwx_dom($t).' '.uwx_mon3($t).' '.substr($t, 2, 2);
	}
	$p = explode('-', (string)$ym);
	if(count($p) !== 2) return $ym;
	$m = (int)$p[1] - 1;
	if($m < 0 || $m > 11) return $ym;
	return uwx_mon3('0000-'.$p[1]).'-'.sprintf('%02d', ((int)$p[0]) % 100);
}
/* monthLongLabel: "April 2026" / "1-7 April 2026" */
function uwx_month_long_label($ym){
	$r = uwx_parse_range($ym);
	if($r){
		$f = $r['from']; $t = $r['to'];
		if(substr($f, 0, 7) === substr($t, 0, 7)) return uwx_dom($f).'-'.uwx_dom($t).' '.uwx_monlong($f).' '.substr($f, 0, 4);
		if(substr($f, 0, 4) === substr($t, 0, 4)) return uwx_dom($f).' '.uwx_mon3($f).' - '.uwx_dom($t).' '.uwx_mon3($t).' '.substr($t, 0, 4);
		return uwx_dom($f).' '.uwx_mon3($f).' '.substr($f, 0, 4).' - '.uwx_dom($t).' '.uwx_mon3($t).' '.substr($t, 0, 4);
	}
	$p = explode('-', (string)$ym);
	if(count($p) !== 2) return $ym;
	$m = (int)$p[1] - 1;
	if($m < 0 || $m > 11) return $ym;
	return uwx_monlong('0000-'.$p[1]).' '.(int)$p[0];
}
/* periodDurationLabel: "2 months" / "2 weeks" / "10 days" */
function uwx_period_duration_label($keys){
	$usable = array();
	foreach((array)$keys as $k){ if(uwx_period_day_range($k) !== null) $usable[] = $k; }
	if(empty($usable)) return '-';
	$allMonth = true; foreach($usable as $k){ if(!uwx_is_month_key($k)){ $allMonth = false; break; } }
	if($allMonth){
		sort($usable, SORT_STRING);
		$span = uwx_months_span($usable[0], $usable[count($usable) - 1]);
		return $span ? $span.' month'.($span > 1 ? 's' : '') : '-';
	}
	$from = ''; $to = '';
	foreach($usable as $k){ $r = uwx_period_day_range($k); if($from === '' || $r['from'] < $from) $from = $r['from']; if($to === '' || $r['to'] > $to) $to = $r['to']; }
	$days = uwx_days_span($from, $to);
	if($days === null) return '-';
	if($days % 7 === 0 && $days <= 56){ $w = $days / 7; return $w.' week'.($w > 1 ? 's' : ''); }
	return $days.' day'.($days > 1 ? 's' : '');
}
/* monthKey (Month column text -> "YYYY-MM") */
function uwx_month_key($raw){
	$s = uwx_trim(uwx_strip_bom($raw));
	if($s === '') return null;
	if(preg_match('/^([A-Za-z]{3,9})\s*[-\/\s]\s*(\d{2}|\d{4})$/', $s, $m)){
		$y = (strlen($m[2]) === 2) ? 2000 + (int)$m[2] : (int)$m[2];
		$i = array_search(strtolower(substr($m[1], 0, 3)), array('jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'), true);
		if($i !== false) return sprintf('%04d-%02d', $y, $i + 1);
	}
	if(preg_match('/^(\d{4})-(\d{2})$/', $s, $m)) return $m[1].'-'.$m[2];
	$ts = strtotime($s);
	if($ts !== false) return date('Y-m', $ts);
	return null;
}
function uwx_period_key($raw){
	$v = uwx_trim(uwx_strip_bom((string)$raw));
	if(uwx_is_range_key($v)) return $v;
	return uwx_month_key($v);
}

/* ---------- uploadPeriod.ts: Weekly / Monthly rules ---------- */
function uwx_rules(){
	return array('WEEKLY'=>array('label'=>'Weekly','minDays'=>7,'maxDays'=>7,'maxFiles'=>4), 'MONTHLY'=>array('label'=>'Monthly','minDays'=>28,'maxDays'=>31,'maxFiles'=>12));
}
function uwx_today(){
	try { $d = new DateTime('now', new DateTimeZone('Asia/Kolkata')); } catch(Exception $e){ $d = new DateTime('now'); }
	return $d->format('Y-m-d');
}
function uwx_add_days($iso, $days){ $p = explode('-', $iso); return gmdate('Y-m-d', gmmktime(0, 0, 0, (int)$p[1], (int)$p[2] + (int)$days, (int)$p[0])); }
function uwx_day_label($iso){ return uwx_dom($iso).' '.uwx_mon3($iso).' '.substr($iso, 0, 4); }
function uwx_window_label($from, $to){ return ($from === $to) ? uwx_day_label($from) : uwx_month_long_label($from.'..'.$to); }
function uwx_month_day_counts($from, $to){
	$key = uwx_make_period_key($from, $to);
	if(!$key) return array();
	$out = array();
	foreach(uwx_period_months($key) as $m){
		$start = (strcmp($from, $m.'-01') > 0) ? $from : $m.'-01';
		$end = (strcmp($to, uwx_month_end_day($m)) < 0) ? $to : uwx_month_end_day($m);
		$d = uwx_days_span($start, $end);
		$out[] = array('month'=>$m, 'days'=>($d === null ? 0 : $d));
	}
	return $out;
}
function uwx_analysis_month($from, $to){
	$best = null;
	foreach(uwx_month_day_counts($from, $to) as $e){ if($best === null || $e['days'] >= $best['days']) $best = $e; }
	return $best ? $best['month'] : null;
}
function uwx_check_period($duration, $from, $to, $today = null){
	if($today === null) $today = uwx_today();
	if($from === '' || $to === '' || $from === null || $to === null) return 'Enter both a From date and a To date.';
	if(strcmp($from, $to) > 0) return 'The From date must be on or before the To date.';
	$days = uwx_days_span($from, $to);
	if($days === null) return 'Enter valid dates.';
	if(strcmp($to, $today) > 0) return 'Dates cannot be in the future. The latest allowed date is today, '.uwx_day_label($today).'.';
	$rules = uwx_rules(); $rule = $rules[$duration];
	if($days >= $rule['minDays'] && $days <= $rule['maxDays']) return null;
	$covered = 'This window covers '.$days.' day'.($days === 1 ? '' : 's').'.';
	return ($duration === 'WEEKLY') ? 'A weekly file must cover exactly 7 days. '.$covered : 'A monthly file must cover 28 to 31 days. '.$covered;
}
function uwx_upload_period_key($duration, $from, $to, $today = null){
	if(uwx_check_period($duration, $from, $to, $today) !== null) return null;
	return ($duration === 'MONTHLY') ? uwx_analysis_month($from, $to) : uwx_make_period_key($from, $to);
}
function uwx_check_upload($duration, $entries, $today = null){
	$rules = uwx_rules(); $rule = $rules[$duration];
	if(count($entries) > $rule['maxFiles']){
		return array($rule['label'].' uploads take at most '.$rule['maxFiles'].' files ('.($duration === 'WEEKLY' ? 'one per week' : 'one per month').'). You selected '.count($entries).'.');
	}
	$errors = array();
	foreach($entries as $e){ $err = uwx_check_period($duration, $e['from'], $e['to'], $today); if($err !== null) $errors[] = $e['fileName'].': '.$err; }
	if(!empty($errors)) return $errors;
	$sorted = $entries;
	usort($sorted, function($a, $b){ $c = strcmp($a['from'], $b['from']); return ($c !== 0) ? $c : strcmp($a['to'], $b['to']); });
	$conf = array();
	for($i = 1; $i < count($sorted); $i++){
		$p = $sorted[$i - 1]; $n = $sorted[$i];
		$pair = '"'.$p['fileName'].'" ('.uwx_window_label($p['from'], $p['to']).') and "'.$n['fileName'].'" ('.uwx_window_label($n['from'], $n['to']).')';
		if(strcmp($n['from'], $p['to']) <= 0){ $conf[] = $pair.' overlap. Each file must cover different days.'; continue; }
		$exp = uwx_add_days($p['to'], 1);
		if($n['from'] !== $exp){ $conf[] = $pair.' are not consecutive: '.uwx_window_label($exp, uwx_add_days($n['from'], -1)).' is missing. Each file must start the day after the previous one ends.'; continue; }
		if($duration === 'MONTHLY'){
			$pm = uwx_analysis_month($p['from'], $p['to']); $nm = uwx_analysis_month($n['from'], $n['to']);
			if($nm === $pm) $conf[] = $pair.' are both analysed as '.uwx_month_long_label($pm).'. Each monthly file must cover a different month.';
			elseif($nm !== uwx_next_month($pm)) $conf[] = $pair.' are analysed as '.uwx_month_long_label($pm).' and '.uwx_month_long_label($nm).', skipping '.uwx_month_long_label(uwx_next_month($pm)).'. Monthly files must cover consecutive months.';
		}
	}
	return $conf;
}

/* ---------- csvParser.ts: header, period stamping, merge ---------- */
function uwx_vax_codes(){
	static $set = null;
	if($set === null){
		$set = array();
		foreach(array('bcg','hepb0','hep b0','hep b','opv0','opv-0','opv1','opv-1','opv2','opv-2','opv3','opv-3','opv booster','opv-booster','rvv1','rvv2','rvv3',
			'penta1','penta-1','penta2','penta-2','penta3','penta-3','pcv1','pcv-1','pcv2','pcv-2','pcv 2','pcv booster','pcvbooster',
			'ipv1','ipv-1','fipv1','fipv-1','ipv2','fipv2','ipv3','fipv3','mr1','mr-1','mr2','mr-2',
			'dpt1','dpt 1','dpt2','dpt 2','dpt3','dpt 3','dpt 1st booster','dpt booster 1','dptbooster1','dptb1','je1','je-1','je2','je-2') as $t){ $set[uwx_compact($t)] = true; }
	}
	return $set;
}
function uwx_is_second_header_row($row1, $row2){
	if(empty($row1) || empty($row2)) return false;
	$has = false;
	foreach($row1 as $c){ $n = uwx_loose($c); if(strpos($n, 'children vaccin') !== false || strpos($n, 'vaccinat') !== false){ $has = true; break; } }
	if(!$has) return false;
	$codes = uwx_vax_codes();
	$hits = 0; $numeric = 0; $nonEmpty = 0; $codeLike = 0; $lens = array();
	foreach($row2 as $cell){
		$t = uwx_loose($cell);
		if($t === '') continue;
		$nonEmpty++;
		if(preg_match('/^[+-]?\d+(?:\.\d+)?$/', str_replace(',', '', $t))){ $numeric++; continue; }
		if(isset($codes[uwx_compact($t)])) $hits++;
		$len = mb_strlen($t, 'UTF-8');
		$lens[] = $len;
		$words = preg_split('/\s+/u', $t, -1, PREG_SPLIT_NO_EMPTY);
		if($len <= 14 && count($words) <= 3 && preg_match('/^[a-z0-9 -]+$/u', $t)) $codeLike++;
	}
	if($nonEmpty === 0) return false;
	if($numeric / $nonEmpty >= 0.35) return false;
	if($hits >= 3) return true;
	$ratio = $codeLike / max(1, $nonEmpty - $numeric);
	$median = null;
	if(!empty($lens)){ sort($lens); $median = $lens[(int)floor((count($lens) - 1) / 2)]; }
	return $hits >= 2 && $ratio >= 0.5 && ($median === null || $median <= 10);
}
function uwx_merge_headers($row1, $row2){
	$codes = uwx_vax_codes();
	$n = max(count($row1), count($row2)); $out = array();
	for($i = 0; $i < $n; $i++){
		$a = uwx_trim(isset($row1[$i]) ? $row1[$i] : '');
		$b = uwx_trim(isset($row2[$i]) ? $row2[$i] : '');
		$looks = (bool)preg_match('/^[a-z]{2,8}\s*\d{0,2}(\s*booster)?(\s*\d+)?$/iu', $b);
		$out[] = ($b !== '' && (isset($codes[uwx_compact($b)]) || $looks)) ? $b : ($a !== '' ? $a : $b);
	}
	return $out;
}
/* extractHeader: array('header'=>.., 'start'=>first data row) */
function uwx_extract_header($rawRows){
	$raw0 = array();
	foreach((array)$rawRows[0] as $h){ $raw0[] = uwx_strip_bom(uwx_trim($h)); }
	if(count($rawRows) >= 2){
		$row2 = array(); foreach((array)$rawRows[1] as $h){ $row2[] = uwx_trim($h); }
		if(uwx_is_second_header_row($raw0, $row2)) return array('header'=>uwx_merge_headers($raw0, $row2), 'start'=>2);
	}
	return array('header'=>$raw0, 'start'=>1);
}
/* CSV file -> rows of text cells, completely empty lines skipped (PapaParse skipEmptyLines) */
function uwx_read_csv($path){
	$fh = @fopen($path, 'r');
	if(!$fh) return null;
	if(fread($fh, 3) !== "\xEF\xBB\xBF") rewind($fh); /* the browser's text decoding drops a UTF-8 BOM */
	$rows = array();
	while(($r = fgetcsv($fh, 0, ',', '"', '')) !== false){
		if(count($r) === 1 && ($r[0] === null || $r[0] === '')) continue;
		foreach($r as $i=>$v){ if($v === null) $r[$i] = ''; }
		$rows[] = $r;
	}
	fclose($fh);
	return $rows;
}
/* applyReportingPeriod: the declared period replaces (or becomes) the Month column; a Month
   column naming 2 or more months, any outside the declared window, is a multi-month export */
function uwx_apply_period($rawRows, $period, $key, $fileName){
	if(empty($rawRows)) return $rawRows;
	$x = uwx_extract_header($rawRows);
	$header = $x['header']; $start = $x['start'];
	$idxMonth = uwx_find_month($header);
	if($idxMonth === null){
		$norm = array(); foreach($header as $h){ $norm[] = uwx_norm($h); }
		$idxFac = uwx_find_facility($header);
		$ulb = array('lgd ulb name','ulb name','lgd ulb');
		$idxUlb = uwx_find_contains_any($header, $ulb);
		if($idxUlb === null) $idxUlb = uwx_array_search_first($norm, $ulb);
		$after = ($idxUlb !== null) ? $idxUlb : (($idxFac !== null) ? $idxFac : (count($norm) > 1 ? 1 : 0));
		$at = max(0, $after + 1);
		$out = array();
		foreach($rawRows as $ri=>$r){
			$val = ($ri === 0) ? 'Month' : (($ri < $start) ? '' : $key);
			$out[] = array_merge(array_slice($r, 0, $at), array($val), array_slice($r, $at));
		}
		return $out;
	}
	$named = array();
	for($ri = $start; $ri < count($rawRows); $ri++){
		$k = uwx_period_key(isset($rawRows[$ri][$idxMonth]) ? $rawRows[$ri][$idxMonth] : '');
		if($k){ foreach(uwx_period_months($k) as $m){ $named[$m] = true; } }
	}
	if(count($named) >= 2){
		$wk = uwx_make_period_key($period['from'], $period['to']);
		$in = array(); foreach(($wk ? uwx_period_months($wk) : array()) as $m){ $in[$m] = true; }
		$outside = array(); foreach(array_keys($named) as $m){ if(!isset($in[$m])) $outside[] = $m; }
		sort($outside, SORT_STRING);
		if(!empty($outside)){
			$lbl = array(); foreach($outside as $m){ $lbl[] = uwx_month_long_label($m); }
			throw new Exception('"'.$fileName.'" has rows for '.implode(', ', $lbl).', outside its declared period '.uwx_window_label($period['from'], $period['to']).'. Upload one '.($period['duration'] === 'WEEKLY' ? 'week' : 'month').' per file.');
		}
	}
	$out = array();
	foreach($rawRows as $ri=>$r){
		if($ri < $start){ $out[] = $r; continue; }
		while(count($r) <= $idxMonth) $r[] = '';
		$r[$idxMonth] = $key;
		$out[] = $r;
	}
	return $out;
}
/* parseUwinMultipleCSVFiles: header + data rows, as processUwinRawRows receives them */
function uwx_merge_files($fileRows, $fileNames){
	$months = array('month','reporting month','month name');
	if(count($fileRows) === 1){
		$x = uwx_extract_header($fileRows[0]);
		return array('header'=>$x['header'], 'rows'=>array_slice($fileRows[0], $x['start']));
	}
	$canon = null; $canonNorm = array(); $merged = array();
	foreach($fileRows as $fi=>$raw){
		$x = uwx_extract_header($raw);
		if($canon === null){ $canon = $x['header']; foreach($canon as $h){ $canonNorm[] = uwx_norm($h); } }
		$fileNorm = array(); foreach($x['header'] as $h){ $fileNorm[] = uwx_norm($h); }
		$a = array_values(array_filter($canonNorm, function($h) use ($months){ return !in_array($h, $months, true); }));
		$b = array_values(array_filter($fileNorm, function($h) use ($months){ return !in_array($h, $months, true); }));
		if($a !== $b) throw new Exception('Header mismatch detected in "'.$fileNames[$fi].'". Please ensure all month-wise files have the same columns (except Month).');
		$colMap = array();
		foreach($canonNorm as $cn){ $p = array_search($cn, $fileNorm, true); $colMap[] = ($p === false) ? -1 : $p; }
		for($ri = $x['start']; $ri < count($raw); $ri++){
			$row = $raw[$ri]; $m = array();
			foreach($colMap as $ci){ $m[] = ($ci >= 0 && isset($row[$ci])) ? $row[$ci] : ''; }
			$merged[] = $m;
		}
	}
	/* processUwinRawRows([canonicalHeader, ...mergedRows]) reads its own header row again */
	$x = uwx_extract_header(array_merge(array($canon), array_slice($merged, 0, 1)));
	return array('header'=>$x['header'], 'rows'=>($x['start'] === 2 ? array_slice($merged, 1) : $merged));
}

/* ---------- processUwinRawRows: columns and units at the finest grain ---------- */
function uwx_process($header, $rows){
	$norm = array(); foreach($header as $h){ $norm[] = uwx_norm($h); }
	$c = array('header'=>$header);
	$c['idxBlock'] = uwx_find_block($header);
	$c['idxFac'] = uwx_find_facility($header);
	$c['idxMonth'] = uwx_find_month($header);
	$c['idxOwner'] = uwx_array_search_first($norm, array('ownership','ownership status'));
	$c['idxRU'] = uwx_array_search_first($norm, array('rural/urban','rural urban','rural-urban','rural - urban','ruralurban'));
	$c['idxState'] = uwx_array_search_first($norm, array('state','state name','state_name'));
	$c['idxDist'] = uwx_array_search_first($norm, array('district','district name','district_name'));
	if($c['idxBlock'] === null || $c['idxFac'] === null || $c['idxMonth'] === null){
		throw new Exception('Could not find required columns: Block Name, Facility Name, Month. If this U-WIN file has no Month column, confirm the reporting period during upload.');
	}
	$sp = uwx_find_by_code($header, 'sessions planned'); if($sp === null) $sp = uwx_find_contains_any($header, array('session planned','sessions planned'));
	$sh = uwx_find_by_code($header, 'sessions held'); if($sh === null) $sh = uwx_find_contains_any($header, array('session held','sessions held'));
	$c['idxSessPlanned'] = $sp; $c['idxSessHeld'] = $sh;
	$c['idxBenPW'] = uwx_find_contains_any($header, array('number of pregnant women vaccinated','pregnant women vaccinated','pregnant women'));
	$c['idxBenInf'] = uwx_find_contains_any($header, array('number of infants (0-1 year) vaccinated','infants (0-1 year) vaccinated','infants 0-1 year vaccinated','infants (0-1 year)','infants 0-1 year','infants'));
	$c['idxBenChild'] = uwx_find_contains_any($header, array('number of children (>1 year) vaccinated','children (>1 year) vaccinated','children >1 year vaccinated','children (>1 year)','children >1 year'));
	$c['idxBenAdol'] = uwx_find_contains_any($header, array('number of adolescents vaccinated','adolescents vaccinated','adolescents'));
	$c['idxBenTd1'] = uwx_find_contains_any($header, array('number of women vaccinated with td 1'));
	$c['idxBenTd2'] = uwx_find_contains_any($header, array('number of women vaccinated with td 2'));
	$c['idxBenTdB'] = uwx_find_contains_any($header, array('number of women vaccinated with td-booster','number of women vaccinated with td booster'));
	$c['idxBenTd10'] = uwx_find_contains_any($header, array('number of adolescents vaccinated with td10','adolescents vaccinated with td10'));
	$c['idxBenTd16'] = uwx_find_contains_any($header, array('number of adolescents vaccinated with td16','adolescents vaccinated with td16'));
	$c['idxSubCenter'] = uwx_find_contains_any($header, array('sub center name','sub centre name','subcenter name','subcentre name','sub center','sub centre','subcenter','subcentre'));
	$c['idxSessionSite'] = uwx_find_contains_any($header, array('session site name','session site'));
	$im = $c['idxMonth'];
	$imap = array(); $counts = array(); $allShorts = array();
	for($i = $im + 1; $i < count($header); $i++){
		$short = uwx_short_from_header($header[$i]);
		$base = $short;
		$counts[$base] = isset($counts[$base]) ? $counts[$base] + 1 : 1;
		if($counts[$base] > 1) $short = $base.'-'.$counts[$base];
		$imap[$short] = $i;
		$allShorts[] = $short;
	}
	$tm = uwx_target_map($header, $im + 1);
	foreach($tm['map'] as $k=>$v){ $imap[$k] = $v; }
	$c['indicatorMap'] = $imap; $c['allShorts'] = $allShorts; $c['targetIdx'] = $tm['indices'];

	$nh = count($header);
	$fd = array(); $allMonths = array(); $states = array(); $statesByKey = array(); $dists = array(); $distsByKey = array();
	foreach($rows as $ri=>$r){
		$block = uwx_trim(isset($r[$c['idxBlock']]) ? $r[$c['idxBlock']] : '');
		$fac = uwx_trim(isset($r[$c['idxFac']]) ? $r[$c['idxFac']] : '');
		$scRaw = ($c['idxSubCenter'] !== null) ? uwx_trim(isset($r[$c['idxSubCenter']]) ? $r[$c['idxSubCenter']] : '') : '';
		$sc = ($c['idxSubCenter'] !== null) ? ($scRaw !== '' ? $scRaw : 'Unknown SC') : '';
		$sess = ($c['idxSessionSite'] !== null) ? uwx_trim(isset($r[$c['idxSessionSite']]) ? $r[$c['idxSessionSite']] : '') : '';
		$monRaw = isset($r[$im]) ? (string)$r[$im] : '';
		if($block === '' && $fac === '') continue;
		if(uwx_trim($monRaw) === '') continue;
		$mk = uwx_period_key($monRaw);
		if(!$mk) continue;
		$own = ($c['idxOwner'] !== null) ? uwx_ownership(isset($r[$c['idxOwner']]) ? $r[$c['idxOwner']] : '') : '';
		$ru = ($c['idxRU'] !== null) ? uwx_ru(isset($r[$c['idxRU']]) ? $r[$c['idxRU']] : '') : '';
		if($c['idxState'] !== null){
			$st = uwx_trim(isset($r[$c['idxState']]) ? $r[$c['idxState']] : '');
			if($st !== ''){ $sk = uwx_loose($st); if(!isset($statesByKey[$sk])) $statesByKey[$sk] = $st; $states[$statesByKey[$sk]] = true; }
		}
		$district = ($c['idxDist'] !== null) ? uwx_trim(isset($r[$c['idxDist']]) ? $r[$c['idxDist']] : '') : '';
		if($district !== ''){ $dk = uwx_loose($district); if(!isset($distsByKey[$dk])) $distsByKey[$dk] = $district; $district = $distsByKey[$dk]; $dists[$district] = true; }
		$allMonths[$mk] = uwx_month_short_label($mk);
		$key = $district.'||'.$block.'||'.$fac.'||'.$sc.'||'.$sess;
		if(!isset($fd[$key])){
			$fd[$key] = array('district'=>$district, 'block'=>$block, 'facility'=>$fac, 'subcenter'=>($c['idxSubCenter'] !== null ? $sc : null), 'sessionsite'=>$sess, 'ownership'=>'', 'ru'=>'', 'months'=>array());
		}
		if($own !== ''){ if($fd[$key]['ownership'] === '') $fd[$key]['ownership'] = $own; elseif($fd[$key]['ownership'] !== $own) $fd[$key]['ownership'] = 'Mixed'; }
		if($ru !== ''){ if($fd[$key]['ru'] === '') $fd[$key]['ru'] = $ru; elseif($fd[$key]['ru'] !== $ru) $fd[$key]['ru'] = 'Mixed'; }
		if(!isset($fd[$key]['months'][$mk])){
			$vals = array(); for($ci = $im + 1; $ci < $nh; $ci++){ $vals[$ci] = null; }
			$fd[$key]['months'][$mk] = array('vals'=>$vals, 'ris'=>array());
		}
		$fd[$key]['months'][$mk]['ris'][] = $ri;
		for($ci = $im + 1; $ci < $nh; $ci++){
			$v = uwx_num(isset($r[$ci]) ? $r[$ci] : null);
			if($v !== null) $fd[$key]['months'][$mk]['vals'][$ci] = ($fd[$key]['months'][$mk]['vals'][$ci] === null ? 0 : $fd[$key]['months'][$mk]['vals'][$ci]) + $v;
		}
	}
	$gFac = array(); $gBlock = array(); $gSc = array(); $gSs = array();
	foreach($fd as $u){
		$fk = uwx_fac_key($u['district'].'||'.$u['block'].'||'.$u['facility']);
		if($fk !== '' && !isset($gFac[$fk])) $gFac[$fk] = array('ownership'=>$u['ownership'], 'ru'=>$u['ru']);
		if(uwx_trim($u['block']) !== '') $gBlock[$u['district'].'||'.uwx_trim($u['block'])] = true;
		if($c['idxSubCenter'] !== null && uwx_trim((string)$u['subcenter']) !== '') $gSc[uwx_fac_key($u['district'].'||'.$u['block'].'||'.$u['facility'].'||'.$u['subcenter'])] = true;
		if(uwx_trim($u['sessionsite']) !== '') $gSs[uwx_fac_key($u['district'].'||'.$u['block'].'||'.$u['facility'].'||'.$u['sessionsite'])] = true;
	}
	$c['facilityData'] = $fd;
	ksort($allMonths, SORT_STRING);
	$c['allMonths'] = $allMonths;
	$c['globalFacilityCount'] = count($gFac);
	$c['globalSubCenterCount'] = count($gSc);
	$c['globalSessionSiteCount'] = count($gSs);
	$c['globalBlockCount'] = count($gBlock);
	$st = array_keys($states); $ds = array_keys($dists);
	$c['stateName'] = (count($st) === 1) ? $st[0] : (count($st) > 1 ? 'Multiple' : '—');
	$c['distName'] = (count($ds) === 1) ? $ds[0] : (count($ds) > 1 ? 'Multiple' : '—');
	return $c;
}
/* standardAnalysisMode: Sub Center-wise when the file has a Sub Center column */
function uwx_standard_mode($c){ return ($c['idxSubCenter'] !== null) ? 'subcenter' : 'facility'; }
/* aggregateToLevel: roll the finest grain up to facility / sub center / session site */
function uwx_aggregate($fdIn, $level){
	$out = array();
	foreach($fdIn as $u){
		$parts = array($u['district'], $u['block'], $u['facility']);
		if($level === 'subcenter') $parts[] = ($u['subcenter'] === null ? 'Unknown SC' : $u['subcenter']);
		if($level === 'sessionsite') $parts[] = $u['sessionsite'];
		$key = implode('||', $parts);
		if(!isset($out[$key])){
			$out[$key] = array('district'=>$u['district'], 'block'=>$u['block'], 'facility'=>$u['facility'],
				'subcenter'=>($level === 'subcenter' ? ($u['subcenter'] === null ? 'Unknown SC' : $u['subcenter']) : null),
				'sessionsite'=>($level === 'sessionsite' ? $u['sessionsite'] : null), 'ownership'=>'', 'ru'=>'', 'months'=>array());
		}
		$a =& $out[$key];
		if($u['ownership'] !== ''){ if($a['ownership'] === '') $a['ownership'] = $u['ownership']; elseif($a['ownership'] !== $u['ownership']) $a['ownership'] = 'Mixed'; }
		if($u['ru'] !== ''){ if($a['ru'] === '') $a['ru'] = $u['ru']; elseif($a['ru'] !== $u['ru']) $a['ru'] = 'Mixed'; }
		foreach($u['months'] as $mk=>$md){
			if(!isset($a['months'][$mk])) $a['months'][$mk] = array('vals'=>array(), 'ris'=>array());
			foreach($md['ris'] as $ri){ $a['months'][$mk]['ris'][] = $ri; }
			foreach($md['vals'] as $ci=>$v){
				if($v === null){ if(!array_key_exists($ci, $a['months'][$mk]['vals'])) $a['months'][$mk]['vals'][$ci] = null; continue; }
				$a['months'][$mk]['vals'][$ci] = (isset($a['months'][$mk]['vals'][$ci]) ? $a['months'][$mk]['vals'][$ci] : 0) + $v;
			}
		}
		unset($a);
	}
	return $out;
}

/* ---------- scoringProfile.ts ---------- */
function uwx_outlier_vax(){ return array('BCG','Penta1','Penta3','MR1','MR2'); }
function uwx_pair_defaults(){ return array('Penta1→Penta3','MR1→MR2','Penta3→MR1'); }
/* web filter state: blocks, months, ownership, ru, outliersVax, addVax, outliersInc, outliersDrop,
   dropRanges, dropPairs, dropFrom, dropTo, inconsFrom, inconsTo, analysisMode */
function uwx_standard_filters($f){
	$f['outliersVax'] = uwx_outlier_vax(); $f['addVax'] = array();
	$f['outliersInc'] = array('INC_EXT'); $f['outliersDrop'] = array('DROP_EXT');
	$f['dropRanges'] = array('R20P'); $f['dropPairs'] = uwx_pair_defaults();
	$f['dropFrom'] = array(); $f['dropTo'] = array(); $f['inconsFrom'] = array(); $f['inconsTo'] = array();
	return $f;
}
function uwx_method_signature($f){
	$setKey = function($vals){ $o = array(); foreach((array)$vals as $v){ $v = uwx_trim($v); if($v !== '') $o[$v] = true; } $o = array_keys($o); sort($o, SORT_STRING); return implode('|', $o); };
	$pairs = function($from, $to){ $k = array(); $n = max(count((array)$from), count((array)$to)); for($i = 0; $i < $n; $i++){ $l = uwx_trim(isset($from[$i]) ? $from[$i] : ''); $r = uwx_trim(isset($to[$i]) ? $to[$i] : ''); if($l !== '' && $r !== '' && $l !== $r) $k[] = $l.'→'.$r; } return $k; };
	$base = !empty($f['outliersVax']) ? $f['outliersVax'] : uwx_outlier_vax();
	return json_encode(array(
		$setKey(array_merge((array)$base, (array)$f['addVax'])), $setKey($f['outliersInc']), $setKey($f['outliersDrop']), $setKey($f['dropRanges']),
		$setKey(array_merge((array)$f['dropPairs'], $pairs($f['dropFrom'], $f['dropTo']))), $setKey($pairs($f['inconsFrom'], $f['inconsTo'])),
	));
}

/* ---------- computeKpis.ts: every check at the selected level ----------
   Returns the cards (stat: total / any / all / eligible / keys) in the web application's
   order, plus the on-screen tables of this tool. Y/N matrices use this tool's convention:
   N = issue, Y = no issue, '–' = left to Zero coverage session. */
function uwx_compute($c, $f){
	$header = $c['header']; $im = $c['idxMonth']; $imap = $c['indicatorMap']; $nh = count($header);
	$mode = in_array($f['analysisMode'], array('facility','subcenter','sessionsite'), true) ? $f['analysisMode'] : 'facility';
	$fd = uwx_aggregate($c['facilityData'], $mode);
	$unitName = function($u) use ($mode){ return ($mode === 'subcenter') ? (string)$u['subcenter'] : (($mode === 'sessionsite') ? (string)$u['sessionsite'] : ''); };

	$selMonths = !empty($f['months']) ? array_values($f['months']) : array_keys($c['allMonths']);
	sort($selMonths, SORT_STRING);
	$labels = array(); foreach($selMonths as $mk){ $labels[$mk] = uwx_month_year_label($mk); }

	$accBase = !empty($f['outliersVax']) ? $f['outliersVax'] : uwx_outlier_vax();
	$accAll = array_values(array_unique(array_merge((array)$accBase, (array)$f['addVax'])));
	$accVax = array(); foreach($accAll as $v){ if(isset($imap[$v])) $accVax[] = $v; }
	if(empty($accVax)){ foreach(uwx_outlier_vax() as $v){ if(isset($imap[$v])) $accVax[] = $v; } }
	$BASE = array('BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2');
	$cmpDef = $BASE; if(isset($imap['FIC-Total'])) $cmpDef[] = 'FIC-Total';
	$cmpVax = array(); foreach(array_values(array_unique($cmpDef)) as $v){ if(isset($imap[$v])) $cmpVax[] = $v; }
	if(empty($cmpVax)){ foreach($BASE as $v){ if(isset($imap[$v])) $cmpVax[] = $v; } }

	$selBlocks = array();
	if(!empty($f['blocks'])){ foreach($f['blocks'] as $b){ $selBlocks[(string)$b] = true; } }
	else { foreach($fd as $u){ if($u['block'] !== '') $selBlocks[$u['block']] = true; } }
	$selMonthSet = array_fill_keys($selMonths, true);
	$selOwn = !empty($f['ownership']) ? array_fill_keys($f['ownership'], true) : null;
	$selRu = !empty($f['ru']) ? array_fill_keys($f['ru'], true) : null;
	$units = array();
	foreach($fd as $key=>$u){
		if($u['block'] !== '' && !isset($selBlocks[$u['block']])) continue;
		if($selOwn !== null && $u['ownership'] !== '' && !isset($selOwn[$u['ownership']])) continue;
		if($selRu !== null && $u['ru'] !== '' && !isset($selRu[$u['ru']])) continue;
		$keep = array(); foreach($u['months'] as $mk=>$md){ if(isset($selMonthSet[$mk])) $keep[$mk] = $md; }
		if(empty($keep)) continue;
		$u['months'] = $keep;
		$units[$key] = $u;
	}
	$den = count($units);
	$blk = array(); foreach($units as $u){ if($u['block'] !== '') $blk[$u['district'].'||'.$u['block']] = true; }

	$HL = array();
	$hlRows = function($dk, $md) use (&$HL){ foreach($md['ris'] as $ri){ $HL[$dk][$ri] = isset($HL[$dk][$ri]) ? $HL[$dk][$ri].',-1' : '-1'; } };
	$hlCells = function($dk, $md, $cols, $style = 1) use (&$HL){
		$t = ''; foreach((array)$cols as $ci){ if($ci !== null) $t .= ($t === '' ? '' : ',').(int)$ci.($style >= 2 ? ':2' : ''); }
		if($t === '') return;
		foreach($md['ris'] as $ri){ $HL[$dk][$ri] = isset($HL[$dk][$ri]) ? $HL[$dk][$ri].','.$t : $t; }
	};
	$stat = function(){ return array('keys'=>array(), 'any'=>array(), 'all'=>array(), 'eligible'=>array()); };
	$flag = function(&$s, $key, $hit, $evaluable){ $s['keys'][$key] = true; if($evaluable > 0 && $hit === $evaluable) $s['all'][$key] = true; else $s['any'][$key] = true; };
	$val = function($md, $ci){ return ($md !== null && $ci !== null && isset($md['vals'][$ci])) ? $md['vals'][$ci] : null; };
	$idHead = array('LGD Block Name','Health Facility Name'); if($mode === 'subcenter') $idHead[] = 'Sub Center Name'; elseif($mode === 'sessionsite') $idHead[] = 'Session Site Name';
	$idRow = function($u) use ($mode, $unitName){ $r = array(uwx_display_block($u['block']), $u['facility']); if($mode !== 'facility') $r[] = $unitName($u); return $r; };
	$idObj = function($u) use ($unitName){ return array('block'=>uwx_display_block($u['block']), 'facility'=>$u['facility'], 'sessionsite'=>$unitName($u)); };
	$mHead = array(); foreach($selMonths as $mk){ $mHead[] = $labels[$mk]; }
	$iSP = $c['idxSessPlanned']; $iSH = $c['idxSessHeld'];
	$out = array('mode'=>$mode, 'units'=>$units, 'den'=>$den, 'blocksSel'=>count($blk), 'selMonths'=>$selMonths, 'labels'=>$labels, 'idHead'=>$idHead,
		'accVax'=>$accVax, 'cmpVax'=>$cmpVax);

	/* t9: Zero coverage session (a period with a session held and zero beneficiaries) */
	$t9 = $stat(); $t9Rows = array(array_merge($idHead, $mHead)); $t9Hit = array();
	$t9Ben = array(); foreach(array('idxBenPW','idxBenInf','idxBenChild','idxBenAdol','idxBenTd1','idxBenTd2','idxBenTdB','idxBenTd10','idxBenTd16') as $bk){ if($c[$bk] !== null) $t9Ben[] = $c[$bk]; }
	if(!empty($t9Ben)){
		foreach($units as $key=>$u){
			$row = $idRow($u); $hit = 0; $ev = 0;
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$zero = false;
				$held = ($md !== null && $iSH !== null) ? $val($md, $iSH) : null;
				$sessHeld = ($iSH === null) || ($held !== null && $held > 0);
				if($md !== null && $sessHeld){
					$sum = 0; $has = false;
					foreach($t9Ben as $bi){ $v = $val($md, $bi); if($v !== null){ $sum += $v; $has = true; } }
					if($has) $ev++;
					$zero = ($has && $sum == 0);
				}
				$row[] = $zero ? 'N' : 'Y';
				if($zero){ $hit++; $t9Hit[$key][$mk] = true; $hlCells('t9', $md, $t9Ben); }
			}
			if($ev > 0) $t9['eligible'][$key] = true;
			if($hit > 0){ $flag($t9, $key, $hit, $ev); $t9Rows[] = $row; }
		}
	}
	/* t0: every vaccine-dose column reported and 0 (periods t9 flagged are left to t9) */
	$t0 = $stat(); $t0Rows = array(array_merge($idHead, $mHead)); $zeroDose = array(); $tIdx = $c['targetIdx'];
	foreach($units as $key=>$u){
		$row = $idRow($u); $hit = 0; $ev = 0;
		foreach($selMonths as $mk){
			$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
			$zero = false;
			if($md !== null){
				$allZero = true; $has = false;
				foreach($tIdx as $ci){ $v = $val($md, $ci); if($v === null){ $allZero = false; break; } $has = true; if($v != 0){ $allZero = false; break; } }
				$zero = ($has && $allZero);
				if($zero) $zeroDose[$key][$mk] = true;
				if(!empty($t9Hit[$key][$mk])){ $row[] = '–'; continue; }
				$ev++;
			}
			$row[] = $zero ? 'N' : 'Y';
			if($zero){ $hit++; $hlRows('t0', $md); }
		}
		if($ev > 0 && !empty($tIdx)) $t0['eligible'][$key] = true;
		if($hit > 0){ $flag($t0, $key, $hit, $ev); $t0Rows[] = $row; }
	}
	/* t7: every column after Month reported, non-zero and equal */
	$t7 = $stat(); $t7Rows = array(array_merge($idHead, $mHead));
	foreach($units as $key=>$u){
		$row = $idRow($u); $hit = 0; $ev = 0;
		foreach($selMonths as $mk){
			$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
			$rep = false;
			if($md !== null){
				$ev++;
				$first = null; $ok = true; $has = false;
				for($ci = $im + 1; $ci < $nh; $ci++){
					$v = $val($md, $ci);
					if($v === null || $v == 0){ $ok = false; break; }
					if($first === null){ $first = $v; $has = true; } elseif($v != $first){ $ok = false; break; }
				}
				$rep = ($has && $ok);
			}
			$row[] = $rep ? 'N' : 'Y';
			if($rep){ $hit++; $hlRows('t7', $md); }
		}
		if($ev > 0) $t7['eligible'][$key] = true;
		if($hit > 0){ $flag($t7, $key, $hit, $ev); $t7Rows[] = $row; }
	}
	/* t2: Key Missing Indicators (fixed vaccines; not scored for U-WIN) */
	$t2 = $stat(); $t2Matrix = array(); $blankCnt = array(); $blankAll = array();
	foreach($cmpVax as $vx){ $blankCnt[$vx] = 0; $blankAll[$vx] = 0; }
	$t2Flat = array($idHead); foreach($cmpVax as $vx){ foreach($selMonths as $mk){ $t2Flat[0][] = $vx.' '.$labels[$mk]; } }
	foreach($units as $key=>$u){
		$any = false; $cells = array(); $flatRow = $idRow($u);
		foreach($cmpVax as $vx){
			$ci = isset($imap[$vx]) ? $imap[$vx] : null; $hasB = false; $allB = true;
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$blank = ($md !== null && $ci !== null) ? ($val($md, $ci) === null) : false;
				$cells[$vx][$mk] = $blank ? 'N' : 'Y';
				$flatRow[] = $cells[$vx][$mk];
				if($blank){ $any = true; $hasB = true; $hlCells('t2', $md, array($ci)); } else { $allB = false; }
			}
			if($hasB) $blankCnt[$vx]++;
			if($allB) $blankAll[$vx]++;
		}
		if($any){
			$rep = 0; $bm = 0;
			foreach($selMonths as $mk){
				if(isset($u['months'][$mk])) $rep++;
				foreach($cmpVax as $vx){ if($cells[$vx][$mk] === 'N'){ $bm++; break; } }
			}
			$flag($t2, $key, $bm, $rep);
			$t2Matrix[$key] = array_merge($idObj($u), array('cells'=>$cells));
			$t2Flat[] = $flatRow;
		}
	}
	if(!empty($cmpVax)){ foreach($units as $key=>$u){ $t2['eligible'][$key] = true; } }

	/* t6: Planned but not held (periods with both reported) */
	$t6 = $stat(); $t6Web = array('months'=>$selMonths, 'monthLabels'=>$labels, 'rows'=>array());
	if($iSP !== null && $iSH !== null){
		foreach($units as $key=>$u){
			$cells = array(); $sumP = 0; $sumH = 0; $hit = 0; $ev = 0;
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$P = $val($md, $iSP); $H = $val($md, $iSH);
				$cells[$mk] = array('p'=>$P, 'h'=>$H, 'pct'=>null, 'hit'=>false);
				if($P === null || $H === null) continue;
				$ev++; $sumP += $P; $sumH += $H;
				if($P > 0 && $H < $P){ $hit++; $cells[$mk]['pct'] = ($P - $H) / $P * 100; $cells[$mk]['hit'] = true; $hlCells('t6', $md, array($iSP, $iSH)); }
			}
			if($ev > 0) $t6['eligible'][$key] = true;
			if($hit > 0){
				$flag($t6, $key, $hit, $ev);
				$totHit = ($sumP > 0 && $sumH < $sumP);
				$t6Web['rows'][$key] = array_merge($idObj($u), array('cells'=>$cells, 'totals'=>array('p'=>$sumP, 'h'=>$sumH, 'pct'=>($totHit ? ($sumP - $sumH) / $sumP * 100 : null), 'hit'=>$totHit)));
			}
		}
	}
	/* t8: Avg Beneficiaries per Session < 5 (periods t9 flagged are left to t9) */
	$t8 = $stat(); $t8Web = array('months'=>$selMonths, 'monthLabels'=>$labels, 'rows'=>array());
	if($iSH !== null){
		$benCols = array($c['idxBenPW'], $c['idxBenInf'], $c['idxBenChild'], $c['idxBenAdol']);
		foreach($units as $key=>$u){
			$cells = array(); $flg = 0; $ev = 0; $tS = 0; $tB = 0;
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$sess = $val($md, $iSH); $ben = null;
				if($md !== null){ $sum = 0; $has = false; foreach($benCols as $bi){ if($bi !== null){ $v = $val($md, $bi); if($v !== null){ $sum += $v; $has = true; } } } if($has) $ben = $sum; }
				$avg = null;
				if($sess !== null && $sess > 0 && $ben !== null && empty($t9Hit[$key][$mk])) $avg = $ben / $sess;
				$low = ($avg !== null && $avg < 5);
				$cells[$mk] = array('held'=>$sess, 'ben'=>$ben, 'avg'=>$avg, 'flag'=>$low);
				if($avg !== null) $ev++;
				if($low){ $flg++; $cols = array($iSH); foreach($benCols as $bi){ if($bi !== null) $cols[] = $bi; } $hlCells('t8', $md, $cols); }
				if($sess !== null) $tS += $sess;
				if($ben !== null) $tB += $ben;
			}
			$allAvg = ($tS > 0) ? $tB / $tS : null;
			if($ev > 0) $t8['eligible'][$key] = true;
			if($flg > 0){
				$flag($t8, $key, $flg, $ev);
				$t8Web['rows'][$key] = array_merge($idObj($u), array('cells'=>$cells, 'totals'=>array('held'=>($tS ? $tS : null), 'ben'=>($tB ? $tB : null), 'avg'=>$allAvg, 'flag'=>($allAvg !== null && $allAvg < 5))));
			}
		}
	}
	/* t3: Outliers - consecutive periods only; a pair with an all-zero-dose period is not compared */
	$incSel = array_fill_keys((array)$f['outliersInc'], true); $dropSel = array_fill_keys((array)$f['outliersDrop'], true);
	$pairList = array();
	for($i = 0; $i < count($selMonths) - 1; $i++){
		$m1 = $selMonths[$i]; $m2 = $selMonths[$i + 1];
		if(!uwx_periods_consecutive($m1, $m2)) continue;
		$pairList[] = array('k'=>$m1.'|'.$m2, 'm1'=>$m1, 'm2'=>$m2, 'm1lbl'=>$labels[$m1], 'm2lbl'=>$labels[$m2]);
	}
	$t3 = $stat(); $t3Rows = array(); $outAny = array(); $outAll = array();
	foreach($accVax as $vx){ $outAny[$vx] = 0; $outAll[$vx] = 0; }
	foreach($units as $key=>$u){
		$cells = array(); $evP = array(); $hitP = array();
		foreach($accVax as $vx){
			$ci = $imap[$vx]; $vEv = 0; $vHit = 0;
			foreach($pairList as $p){
				$md1 = isset($u['months'][$p['m1']]) ? $u['months'][$p['m1']] : null;
				$md2 = isset($u['months'][$p['m2']]) ? $u['months'][$p['m2']] : null;
				$v1 = $val($md1, $ci); $v2 = $val($md2, $ci);
				$zm = !empty($zeroDose[$key][$p['m1']]) || !empty($zeroDose[$key][$p['m2']]);
				$ch = $zm ? null : dqa_mom_change($v1, $v2);
				$hit = false;
				if($ch !== null){
					$evP[$p['k']] = true; $vEv++;
					$band = dqa_outlier_band($ch);
					if($band !== null && (isset($incSel[$band]) || isset($dropSel[$band]))){
						$hit = true; $vHit++; $hitP[$p['k']] = true;
						$hlCells('t3', $md1, array($ci)); $hlCells('t3', $md2, array($ci));
					}
				}
				$cells[$vx][$p['k']] = array('a'=>$v1, 'b'=>$v2, 'pct'=>($ch ? $ch['pct'] : null), 'hit'=>$hit, 'fromZero'=>($ch ? $ch['fromZero'] : false));
			}
			if($vHit > 0) $outAny[$vx]++;
			if($vEv > 0 && $vHit === $vEv) $outAll[$vx]++;
		}
		if(!empty($evP)) $t3['eligible'][$key] = true;
		if(!empty($hitP)){ $flag($t3, $key, count($hitP), count($evP)); $t3Rows[$key] = array_merge($idObj($u), array('cells'=>$cells)); }
	}
	/* Dropouts - cumulative over the selected periods where both doses are reported; none for 1 period */
	$rngSel = array_fill_keys((array)$f['dropRanges'], true);
	$pairs = array(); foreach((array)$f['dropPairs'] as $pl){ $pairs[(string)$pl] = true; }
	$fl = (array)$f['dropFrom']; $tl = (array)$f['dropTo'];
	for($i = 0; $i < max(count($fl), count($tl)); $i++){
		$a = uwx_trim(isset($fl[$i]) ? $fl[$i] : ''); $b = uwx_trim(isset($tl[$i]) ? $tl[$i] : '');
		if($a !== '' && $b !== '' && $a !== $b) $pairs[$a.'→'.$b] = true;
	}
	if(count($selMonths) < 2) $pairs = array();
	$drops = array();
	foreach(array_keys($pairs) as $pl){
		$pp = explode('→', $pl);
		if(count($pp) !== 2) continue;
		$from = uwx_trim($pp[0]); $to = uwx_trim($pp[1]);
		if($from === '' || $to === '' || !isset($imap[$from]) || !isset($imap[$to])) continue;
		$iF = $imap[$from]; $iT = $imap[$to];
		$dk = 'drop_'.uwx_safe_key($from.'_'.$to);
		$ds = $stat(); $rowsD = array();
		foreach($units as $key=>$u){
			$cells = array(); $sa = 0; $sb = 0; $n = 0; $ev = 0; $mh = 0; $matched = array();
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$A = $val($md, $iF); $B = $val($md, $iT);
				$cells[$mk] = array('from'=>null, 'to'=>null, 'pct'=>null);
				if($A === null || $B === null) continue;
				$matched[] = $mk; $sa += $A; $sb += $B; $n++;
				$mp = dqa_dropout_pct($A, $B);
				$cells[$mk] = array('from'=>$A, 'to'=>$B, 'pct'=>$mp);
				if($mp !== null){ $ev++; $rg = dqa_dropout_range($mp); if($rg !== null && isset($rngSel[$rg])) $mh++; }
			}
			$pp2 = dqa_dropout_pct($n > 0 ? $sa : 0, $n > 0 ? $sb : 0);
			if($pp2 !== null) $ds['eligible'][$key] = true;
			$rg2 = dqa_dropout_range($pp2);
			if($rg2 !== null && isset($rngSel[$rg2])){
				$ds['keys'][$key] = true;
				if($ev > 0 && $mh === $ev) $ds['all'][$key] = true; else $ds['any'][$key] = true;
				foreach($matched as $mk){ $hlCells($dk, $u['months'][$mk], array($iF, $iT)); }
				$rowsD[$key] = array_merge($idObj($u), array('cells'=>$cells, 'all'=>array('from'=>$sa, 'to'=>$sb, 'pct'=>$pp2)));
			}
		}
		$drops[$dk] = array('label'=>$pl, 'from'=>$from, 'to'=>$to, 'stat'=>$ds, 'web'=>array('pairLabel'=>$pl, 'from'=>$from, 'to'=>$to, 'months'=>$selMonths, 'monthLabels'=>$labels, 'rows'=>$rowsD));
	}
	/* Later dose > earlier dose: period totals over periods where both are reported */
	$doseOrder = function($iFrom, $iTo, $dk, $toLbl, $fromLbl) use ($units, $selMonths, $stat, $flag, $val, $idRow, $idHead, $hlCells){
		$s = $stat(); $rows = array(array_merge($idHead, array($toLbl.' (total)', $fromLbl.' (total)', '% change')));
		foreach($units as $key=>$u){
			$a = 0; $b = 0; $n = 0; $mh = 0; $mds = array();
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$A = $val($md, $iFrom); $B = $val($md, $iTo);
				if(dqa_later_dose_exceeds($A, $B)) $mh++;
				if($A === null || $B === null) continue;
				$a += $A; $b += $B; $n++; $mds[] = $md;
			}
			if($n === 0) continue;
			$s['eligible'][$key] = true;
			if(dqa_later_dose_exceeds($a, $b)){
				$flag($s, $key, $mh, $n);
				foreach($mds as $md){ $hlCells($dk, $md, array($iFrom, $iTo)); }
				$rows[] = array_merge($idRow($u), array(round($b), round($a), dqa_dose_excess_label($a, $b)));
			}
		}
		return array('stat'=>$s, 'rows'=>$rows);
	};
	$i1 = (isset($imap['Penta1']) && isset($imap['Penta3'])) ? $doseOrder($imap['Penta1'], $imap['Penta3'], 't5_p3gtp1', 'Penta3', 'Penta1') : array('stat'=>$stat(), 'rows'=>array(array_merge($idHead, array('Penta3 (total)','Penta1 (total)','% change'))));
	$i2 = (isset($imap['MR1']) && isset($imap['MR2'])) ? $doseOrder($imap['MR1'], $imap['MR2'], 't5_mr2gtmr1', 'MR2', 'MR1') : array('stat'=>$stat(), 'rows'=>array(array_merge($idHead, array('MR2 (total)','MR1 (total)','% change'))));
	$incons = array();
	$ifl = (array)$f['inconsFrom']; $itl = (array)$f['inconsTo'];
	for($i = 0; $i < max(count($ifl), count($itl)); $i++){
		$a = uwx_trim(isset($ifl[$i]) ? $ifl[$i] : ''); $b = uwx_trim(isset($itl[$i]) ? $itl[$i] : '');
		if($a === '' || $b === '' || $a === $b) continue;
		if($a.'→'.$b === 'Penta1→Penta3' || $a.'→'.$b === 'MR1→MR2') continue;
		if(!isset($imap[$a]) || !isset($imap[$b])) continue;
		$pid = 'iadd_'.uwx_safe_key($b.'_gt_'.$a); $dl = 't5_'.uwx_safe_key($b.'_gt_'.$a);
		$r = $doseOrder($imap[$a], $imap[$b], $dl, $b, $a);
		$incons[$dl] = array('from'=>$a, 'to'=>$b, 'label'=>'Inconsistencies — '.$b.'>'.$a, 'pid'=>$pid, 'stat'=>$r['stat'], 'rows'=>$r['rows']);
	}
	/* Co-administration: period by period; blanks never compared */
	$CO = array('co1'=>array('OPV1','Penta1','RVV1','PCV1','IPV1'), 'co2'=>array('OPV2','Penta2','RVV2'), 'co3'=>array('OPV3','Penta3','RVV3','PCV2','IPV2'), 'co4'=>array('MR1','PCV Booster','IPV3'), 'co5'=>array('MR2','DPT 1st Booster'));
	$co = array();
	foreach($CO as $ck=>$vl){
		$cs = $stat(); $rowsC = array();
		foreach($units as $key=>$u){
			$rv = array(); $viol = 0; $ev = 0; $red = array();
			foreach($selMonths as $mk){
				$md = isset($u['months'][$mk]) ? $u['months'][$mk] : null;
				$rv[$mk] = array(); $nn = 0;
				foreach($vl as $vx){ $v = ($md !== null && isset($imap[$vx])) ? $val($md, $imap[$vx]) : null; $rv[$mk][$vx] = $v; if($v !== null) $nn++; }
				if($nn >= 2) $ev++;
				$oor = dqa_coadmin_out_of_range($rv[$mk]);
				if(!empty($oor)){
					$viol++;
					$mask = 0; $grp = array(); $bad = array();
					foreach($vl as $vi=>$vx){
						if(isset($oor[$vx])) $mask |= (1 << $vi);
						if(!isset($imap[$vx]) || $rv[$mk][$vx] === null) continue;
						if(isset($oor[$vx])) $bad[] = $imap[$vx]; else $grp[] = $imap[$vx];
					}
					$red[$mk] = $mask;
					$hlCells($ck, $md, $grp, 1); $hlCells($ck, $md, $bad, 2);
				}
			}
			if($ev > 0) $cs['eligible'][$key] = true;
			if($viol > 0){
				$flag($cs, $key, $viol, $ev);
				$rowsC[$key] = array_merge($idObj($u), array('vals'=>$rv, 'red'=>$red, 'totals'=>dqa_coadmin_matched_totals($rv, $vl)));
			}
		}
		$co[$ck] = array('stat'=>$cs, 'web'=>array('key'=>$ck, 'vaccines'=>$vl, 'months'=>$selMonths, 'monthLabels'=>$labels, 'rows'=>$rowsC));
	}

	/* cards, in the web application's order */
	$st = function($s){ return array('total'=>count($s['keys']), 'any'=>count($s['any']), 'all'=>count($s['all']), 'eligible'=>count($s['eligible']), 'keys'=>array_keys($s['keys'])); };
	$cards = array();
	$cards[] = array('id'=>'t0','name'=>'Indicators having 0 values but not blank','stat'=>$st($t0),'group'=>'availability','downloadKey'=>'t0');
	$cards[] = array('id'=>'t7','name'=>'Indicators with same values','stat'=>$st($t7),'group'=>'availability','downloadKey'=>'t7');
	$cards[] = array('id'=>'t9','name'=>'Zero coverage session','stat'=>$st($t9),'group'=>'availability','downloadKey'=>'t9');
	$cards[] = array('id'=>'t2','name'=>'Key Missing Indicators','stat'=>$st($t2),'group'=>'completeness','downloadKey'=>'t2');
	$cards[] = array('id'=>'t6','name'=>'Planned but not held','stat'=>$st($t6),'group'=>'accuracy','downloadKey'=>'t6');
	$cards[] = array('id'=>'t8','name'=>'Avg Beneficiaries per Session < 5','stat'=>$st($t8),'group'=>'accuracy','downloadKey'=>'t8');
	$cards[] = array('id'=>'t3','name'=>'Outliers','stat'=>$st($t3),'group'=>'accuracy','downloadKey'=>'t3');
	foreach($drops as $dk=>$d){ $cards[] = array('id'=>$dk,'name'=>'Dropouts — '.$d['label'],'stat'=>$st($d['stat']),'group'=>'accuracy','downloadKey'=>$dk); }
	$cons = array();
	$cons[] = array('id'=>'i1','name'=>'Inconsistencies — Penta3>Penta1','stat'=>$st($i1['stat']),'group'=>'consistency','downloadKey'=>'t5_p3gtp1');
	$cons[] = array('id'=>'i2','name'=>'Inconsistencies — MR2>MR1','stat'=>$st($i2['stat']),'group'=>'consistency','downloadKey'=>'t5_mr2gtmr1');
	foreach($incons as $dl=>$m){ $cons[] = array('id'=>$m['pid'],'name'=>$m['label'],'stat'=>$st($m['stat']),'group'=>'consistency','downloadKey'=>$dl); }
	$coLabels = array('co1'=>'6 weeks — OPV1, Penta1, RVV1, PCV1, IPV1','co2'=>'10 weeks — OPV2, Penta2, RVV2','co3'=>'14 weeks — OPV3, Penta3, RVV3, PCV2, IPV2','co4'=>'9 months — MR1, PCV Booster, IPV3','co5'=>'2 years — MR2, DPT 1st Booster');
	foreach($co as $ck=>$x){ $cons[] = array('id'=>$ck,'name'=>$coLabels[$ck],'stat'=>$st($x['stat']),'group'=>'consistency','downloadKey'=>$ck); }
	$order = array('co1'=>0,'co3'=>1,'co2'=>2,'co4'=>3,'i1'=>4,'i2'=>5,'co5'=>6);
	$pos = array(); foreach($cons as $i=>$cc){ $pos[$i] = isset($order[$cc['id']]) ? $order[$cc['id']] : 99; }
	$idx = array_keys($cons);
	usort($idx, function($a, $b) use ($pos){ return ($pos[$a] === $pos[$b]) ? ($a - $b) : ($pos[$a] - $pos[$b]); });
	foreach($idx as $i){ $cards[] = $cons[$i]; }

	$out += array('cards'=>$cards, 'HL'=>$HL,
		't0Rows'=>$t0Rows, 't7Rows'=>$t7Rows, 't9Rows'=>$t9Rows, 't9Hit'=>$t9Hit,
		't2Matrix'=>$t2Matrix, 't2Flat'=>$t2Flat, 'blankCnt'=>$blankCnt, 'blankAll'=>$blankAll,
		't6Web'=>$t6Web, 't8Web'=>$t8Web, 'pairList'=>$pairList, 't3Rows'=>$t3Rows, 'outAny'=>$outAny, 'outAll'=>$outAll,
		'drops'=>$drops, 'i1Rows'=>$i1['rows'], 'i2Rows'=>$i2['rows'], 'incons'=>$incons, 'co'=>$co);
	return $out;
}
/* computeUwinKpis: the cards of the settings on screen, plus the cards the SCORE is computed
   from (the standard scoring settings on the same scope) */
function uwx_compute_with_score($c, $f){
	$view = uwx_compute($c, $f);
	$std = uwx_standard_filters($f);
	if(uwx_method_signature($f) === uwx_method_signature($std)){ $view['scoreCards'] = $view['cards']; $view['customMethod'] = false; return $view; }
	$s = uwx_compute($c, $std);
	$view['scoreCards'] = $s['cards']; $view['customMethod'] = true;
	return $view;
}
/* weighted Overall Score of a compute result (scoreUtils.ts computeOverallScore, portal UWIN) */
function uwx_score_of($res){
	$in = array();
	foreach($res['scoreCards'] as $cc){ $in[$cc['id']] = array('flagged'=>(int)$cc['stat']['total'], 'eligible'=>(int)$cc['stat']['eligible'], 'name'=>$cc['name']); }
	return uwx_weighted_score($in, $res['den'], count($res['selMonths']));
}
/* ============== end of web parity engine (U-WIN) ============== */

/* -------------------- Header matching helpers (UWIN) -------------------- */
function header_compact_key($s){
	$s = normalize_header($s);
	// keep only letters+digits
	$s = preg_replace('/[^a-z0-9]+/u','', $s);
	return $s;
}
function find_block_col_index($rawHeader){
	$norm = [];
	$compact = [];
	foreach($rawHeader as $h){
		$norm[] = normalize_header($h);
		$compact[] = header_compact_key($h);
	}

	// 1) Strong preference: LGD Block Name (exact or compact)
	$preferred = ['lgd block name','lgd_block_name','lgd block','lgdblockname'];
	foreach($preferred as $cand){
		$cNorm = normalize_header($cand);
		foreach($norm as $i=>$h){ if($h===$cNorm) return $i; }
		$cComp = preg_replace('/[^a-z0-9]+/u','', $cNorm);
		foreach($compact as $i=>$h){ if($h===$cComp) return $i; }
	}
	// 1b) Compact substring match (handles headers like "LGD Block Name (as per LGD)")
	foreach($compact as $i=>$h){
		if(strpos($h,'lgdblockname')!==false || strpos($h,'lgdblock')!==false) return $i;
	}

	// 2) Fuzzy: contains both 'lgd' and 'block'
	foreach($norm as $i=>$h){
		if(strpos($h,'lgd')!==false && strpos($h,'block')!==false) return $i;
	}
	// 3) Fallbacks (may be empty in some exports)
	$fallback = ['block name','health block name','block'];
	foreach($fallback as $cand){
		$cNorm = normalize_header($cand);
		foreach($norm as $i=>$h){ if($h===$cNorm) return $i; }
		$cComp = preg_replace('/[^a-z0-9]+/u','', $cNorm);
		foreach($compact as $i=>$h){ if($h===$cComp) return $i; }
	}
	// 4) Last resort: any header that contains 'block'
	foreach($norm as $i=>$h){ if(strpos($h,'block')!==false) return $i; }
	return null;
}
function find_facility_col_index($rawHeader){
	$norm = [];
	$compact = [];
	foreach($rawHeader as $h){
		$norm[] = normalize_header($h);
		$compact[] = header_compact_key($h);
	}
	$preferred = ['health facility name','health_facility_name','facility name','facility_name'];
	foreach($preferred as $cand){
		$cNorm = normalize_header($cand);
		foreach($norm as $i=>$h){ if($h===$cNorm) return $i; }
		$cComp = preg_replace('/[^a-z0-9]+/u','', $cNorm);
		foreach($compact as $i=>$h){ if($h===$cComp) return $i; }
	}
	// Fuzzy: contains both 'facility' and 'name'
	foreach($norm as $i=>$h){
		if(strpos($h,'facility')!==false && strpos($h,'name')!==false) return $i;
	}
	return null;
}
function find_month_col_index($rawHeader){
	$norm = [];
	foreach($rawHeader as $h){ $norm[] = normalize_header($h); }
	$cands = ['month','reporting month','month name'];
	foreach($cands as $cand){
		$cNorm = normalize_header($cand);
		foreach($norm as $i=>$h){ if($h===$cNorm) return $i; }
	}
	foreach($norm as $i=>$h){
		if(strpos($h,'month')!==false) return $i;
	}
	return null;
}


function find_col_index_contains_any($rawHeader, $needles){
	$norm = [];
	foreach($rawHeader as $h){ $norm[] = normalize_header($h); }
	foreach((array)$needles as $needle){
		$n = normalize_header($needle);
		foreach($norm as $i=>$h){
			if($h===$n) return $i;
			if($n!=='' && strpos($h,$n)!==false) return $i;
		}
	}
	return null;
}



/* --------- Simple HTML .XLS output with CELL-LEVEL highlight styles ---------
   $style_map: [rowIndex => [colIndex => true|string(color)|array]]
   - true => light pink
   - string => background color
   - array => ['color' => '#rrggbb', 'bold' => true]
*/
function output_xls_html_cells($rows, $style_map = []){
	if(empty($rows)) $rows=[['No data']];
	echo "<html><head><meta charset='utf-8'></head><body>";
	echo "<table border='1' cellpadding='4' cellspacing='0' style='border-collapse:collapse;font-family:Arial;font-size:11pt;'>";
	echo "<tr>";
	foreach($rows[0] as $hcell){
		echo "<th style='font-weight:bold;background:#f3f6fb;'>".h($hcell)."</th>";
	}
	echo "</tr>";
	for($i=1;$i<count($rows);$i++){
		echo "<tr>";
		$row = $rows[$i];
		$colCount = count($rows[0]);
		for($c=0;$c<$colCount;$c++){
			$val = isset($row[$c]) ? $row[$c] : '';
			$style = "";
			if(isset($style_map[$i]) && array_key_exists($c, $style_map[$i])){
				$v = $style_map[$i][$c];
				if(is_array($v)){
					$color = isset($v['color']) ? (string)$v['color'] : "#ffc0cb";
					$style = "background:".$color.";";
					if(!empty($v['bold'])){
						$style .= "font-weight:bold;";
					}
				} else {
					$color = ($v===true) ? "#ffc0cb" : (string)$v;
					$style = "background:".$color.";";
				}
			}
			echo "<td style='". $style ."'>".h((string)$val)."</td>";
		}
		echo "</tr>";
	}
	echo "</table></body></html>";
}

/* -------------------- DB (optional) -------------------- */
function db_connect($h,$u,$p,$n){
	$m=@new mysqli($h,$u,$p,$n);
	if($m->connect_errno){
		error_log("DB connect failed: ".$m->connect_error);
		return null;
	}
	$m->set_charset('utf8mb4');
	return $m;
}
function db_bootstrap($m){
	if(!$m) return;
	$m->query("CREATE TABLE IF NOT EXISTS csv_uploads (
		id INT AUTO_INCREMENT PRIMARY KEY,
		uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		filename VARCHAR(255),
		num_rows INT,
		header_json TEXT
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

/* -------------------- Routing: .XLS downloads -------------------- */
if(isset($_GET['download']) && isset($_SESSION['exports'][$_GET['download']])){
	$dqa_guard_msg = dqa_data_guard(isset($_GET['dqa_uid']) ? $_GET['dqa_uid'] : ''); /* (added) data replaced by another upload */
	if($dqa_guard_msg !== null){ header("Content-Type: text/plain; charset=utf-8"); echo $dqa_guard_msg; exit; }
	$exp = $_SESSION['exports'][$_GET['download']];
	$rows = $exp['rows'];
	$label = preg_replace('/[^A-Za-z0-9_\-]+/','_', $exp['label']);
	header("Content-Type: application/vnd.ms-excel; charset=utf-8");
	header('Content-Disposition: attachment; filename="'.$label.'.xls"');
	output_xls_html_cells($rows, []);
	exit;
}

/* Full-file highlighted export */
if(isset($_GET['download_pink'])){
	$key = (string)$_GET['download_pink'];
	if(!isset($_SESSION['csv_header'], $_SESSION['csv_rows'])){
		header("Content-Type: text/plain; charset=utf-8");
		echo "Session expired. Please upload again.";
		exit;
	}
	$dqa_guard_msg = dqa_data_guard(isset($_GET['dqa_uid']) ? $_GET['dqa_uid'] : ''); /* (added) data replaced by another upload */
	if($dqa_guard_msg !== null){
		header("Content-Type: text/plain; charset=utf-8");
		echo $dqa_guard_msg;
		exit;
	}
	/* (added 2026-10) The highlights kept on the server are those of the LATEST results page of
	   this browser. A page opened earlier (Apply Filter pressed again later, in this or another
	   tab, or a page reached with the browser's Back button) would otherwise download cells
	   that do not match what it shows, so such a download is refused. */
	if(!isset($_GET['dqa_rid'], $_SESSION['dqa_render_id']) || (string)$_GET['dqa_rid'] === '' || (string)$_GET['dqa_rid'] !== (string)$_SESSION['dqa_render_id']){
		header("Content-Type: text/plain; charset=utf-8");
		echo 'This results page is older than the latest one shown in this browser (Apply Filter was pressed again afterwards, in this or another tab), so its highlighted cells are no longer kept. Please press Apply Filter on this page again, then download.';
		exit;
	}
	$header = $_SESSION['csv_header'];
	$rows = $_SESSION['csv_rows'];
	$idxBlock = isset($_SESSION['idxBlock']) ? $_SESSION['idxBlock'] : null;
	$idxFac = isset($_SESSION['idxFac']) ? $_SESSION['idxFac'] : null;
	$idxMonth = isset($_SESSION['idxMonth']) ? $_SESSION['idxMonth'] : null;
	$filters = isset($_SESSION['filters']) ? $_SESSION['filters'] : [];
	$pink_sets = isset($_SESSION['pink_fac_sets']) ? $_SESSION['pink_fac_sets'] : [];
	$outlier_hits = isset($_SESSION['pink_outlier_hits']) ? $_SESSION['pink_outlier_hits'] : [];
	$drop_hits = isset($_SESSION['pink_dropout_hits']) ? $_SESSION['pink_dropout_hits'] : [];
	$repeat_hits = isset($_SESSION['pink_repeat_hits']) ? $_SESSION['pink_repeat_hits'] : [];

	$label = $key;
	if(isset($_SESSION['exports'][$key]['label'])){
		$label = $_SESSION['exports'][$key]['label'];
	}
	$label = preg_replace('/[^A-Za-z0-9_\-]+/','_', (string)$label).'_highlighted_fullfile';

	/* (changed 2026-10) The highlighted download now marks EXACTLY the cells that the
	   KPI card / table counted on screen: while the results page is built, every KPI
	   records the row numbers and columns it flagged ($_SESSION['dqa_hl']); this
	   download applies that map to the uploaded rows. Rows stay month by month (no
	   collapsed "All months" rows any more), so Dropouts, Avg Beneficiaries, the
	   Inconsistencies and the vaccine groups follow the Months filter exactly like the
	   card. As before, only the rows of the ticked blocks are written.
	   Colours: light pink = cell counted by the KPI (plus the row's identity cells);
	   dark pink + bold = vaccine-group value shown red in the table. */
	$selBlocksN = [];
	foreach((array)(isset($filters['blocks']) ? $filters['blocks'] : []) as $bk){ $selBlocksN[dqa_unit_norm($bk)] = true; }
	$full = [];
	$full[] = $header;
	$dqa_out_row = [];
	foreach($rows as $dqa_src=>$r){
		if(count($r)<count($header)) $r=array_pad($r,count($header),'');
		if($idxBlock !== null && !empty($selBlocksN)){
			$dqa_bn = dqa_unit_norm(isset($r[$idxBlock]) ? $r[$idxBlock] : '');
			if(!isset($selBlocksN[$dqa_bn])) continue;
		}
		$dqa_out_row[$dqa_src] = count($full);
		$full[] = $r;
	}
	$style_map = [];
	$DARK_PINK = "#ff8fb1";
	$dqa_norm_hdr = isset($_SESSION['csv_norm']) ? $_SESSION['csv_norm'] : array_map('normalize_header', $header);
	$metaCols = [];
	$dqa_real_fac = isset($_SESSION['idxFac']) ? $_SESSION['idxFac'] : null;
	$dqa_sc_col = uwx_find_contains_any($header, array('sub center name','sub centre name','subcenter name','subcentre name','sub center','sub centre','subcenter','subcentre')); /* (changed 2026-11) as the analysis finds it */
	$dqa_ss_col = uwx_find_contains_any($header, array('session site name','session site'));
	foreach([$idxBlock, $dqa_real_fac, $dqa_sc_col, $dqa_ss_col, $idxMonth] as $mc){ if($mc!==null) $metaCols[(int)$mc]=true; }
	$dqa_hl_all = (isset($_SESSION['dqa_hl']) && is_array($_SESSION['dqa_hl'])) ? $_SESSION['dqa_hl'] : array();
	$dqa_hl_key = (isset($dqa_hl_all[$key]) && is_array($dqa_hl_all[$key])) ? $dqa_hl_all[$key] : array();
	$dqa_ncols = count($header);
	foreach($dqa_hl_key as $dqa_src=>$dqa_cells){
		if(!isset($dqa_out_row[$dqa_src])) continue;
		$ri = $dqa_out_row[$dqa_src];
		$dqa_toks = explode(',', (string)$dqa_cells);
		if(in_array('-1', $dqa_toks, true)){ /* whole row (Availability KPIs) */
			for($ci=0;$ci<$dqa_ncols;$ci++){ $style_map[$ri][$ci]=true; }
			continue;
		}
		$dqa_lvl = [];
		foreach($dqa_toks as $dqa_tok){
			$dqa_pp = explode(':', $dqa_tok);
			if($dqa_pp[0]==='' || !is_numeric($dqa_pp[0])) continue;
			$ci = (int)$dqa_pp[0];
			if($ci < 0 || $ci >= $dqa_ncols) continue;
			$st = (isset($dqa_pp[1]) && $dqa_pp[1]==='2') ? 2 : 1;
			if(!isset($dqa_lvl[$ci]) || $dqa_lvl[$ci] < $st) $dqa_lvl[$ci] = $st;
		}
		foreach($dqa_lvl as $ci=>$st){ $style_map[$ri][$ci] = ($st >= 2) ? array('color'=>$DARK_PINK,'bold'=>true) : true; }
		foreach($metaCols as $ci=>$on){ if(!isset($style_map[$ri][$ci])) $style_map[$ri][$ci]=true; }
	}

	header("Content-Type: application/vnd.ms-excel; charset=utf-8");
	header('Content-Disposition: attachment; filename="'.$label.'.xls"');
	output_xls_html_cells($full, $style_map);
	exit;
}

/* -------------------- Upload / Apply Filters flow -------------------- */
$action = isset($_POST['action']) ? $_POST['action'] : null;

/* (removed 2026-11) "Download Word" of the Overall Score page (action download_word_overall) */

if($action==='upload' && isset($_FILES['csv_files'])){
	/* (changed 2026-11, web parity) The U-WIN upload works as in the DQA web application
	   (uploadPeriod.ts, csvParser.ts):
	   - the upload is declared Weekly or Monthly, and every file carries the From - To dates it
	     covers: weekly = exactly 7 days, at most 4 files; monthly = 28 to 31 days, at most 12
	     files, analysed as the calendar month holding most of its days (a tie goes to the later
	     month); files consecutive (no overlap, no gap; monthly files on consecutive months); no
	     date after today;
	   - the declared period becomes the Month column of every row (a Month column naming 2 or
	     more months outside the declared window is a multi-month export and is refused);
	   - a second header row of vaccine codes is merged into the first; every file must have the
	     same columns (Month aside); rows are kept in file order; blank cells stay blank. */
	$f = $_FILES['csv_files'];
	$fileCount = is_array($f['name']) ? count($f['name']) : 0;
	$files = [];
	for($i=0;$i<$fileCount;$i++){
		if(!isset($f['error'][$i]) || $f['error'][$i]===UPLOAD_ERR_NO_FILE) continue;
		$files[] = ['name'=>$f['name'][$i], 'tmp_name'=>$f['tmp_name'][$i], 'error'=>$f['error'][$i], 'idx'=>$i];
	}
	if(empty($files)){ render_page("Please select at least one CSV file."); exit; }
	$uwxDuration = (isset($_POST['uwx_duration']) && in_array((string)$_POST['uwx_duration'], ['WEEKLY','MONTHLY'], true)) ? (string)$_POST['uwx_duration'] : '';
	if($uwxDuration===''){ render_page("Please choose whether the files are weekly or monthly."); exit; }
	$postFrom = isset($_POST['file_from']) ? (array)$_POST['file_from'] : [];
	$postTo = isset($_POST['file_to']) ? (array)$_POST['file_to'] : [];
	$uwxEntries = [];
	foreach($files as $file){
		if($file['error']!==UPLOAD_ERR_OK){ render_page("Upload failed for ".$file['name'].": error code ".$file['error']); exit; }
		$uwxEntries[] = [
			'fileName'=>$file['name'],
			'from'=>trim((string)(isset($postFrom[$file['idx']]) ? $postFrom[$file['idx']] : '')),
			'to'=>trim((string)(isset($postTo[$file['idx']]) ? $postTo[$file['idx']] : '')),
		];
	}
	$uwxProblems = uwx_check_upload($uwxDuration, $uwxEntries);
	if(!empty($uwxProblems)){ render_page($uwxProblems[0]); exit; }
	$allOrigNames = []; $uwxPeriods = []; $fileRowsAll = [];
	try {
		foreach($files as $n=>$file){
			$e = $uwxEntries[$n];
			$key = uwx_upload_period_key($uwxDuration, $e['from'], $e['to']);
			if($key===null) throw new Exception('Invalid reporting period for "'.$file['name'].'". Enter valid dates.');
			$raw = uwx_read_csv($file['tmp_name']);
			if($raw===null) throw new Exception('Cannot open uploaded file: '.$file['name']);
			if(empty($raw)) throw new Exception('Empty file or unreadable header: '.$file['name']);
			$fileRowsAll[] = uwx_apply_period($raw, ['duration'=>$uwxDuration,'from'=>$e['from'],'to'=>$e['to']], $key, $file['name']);
			unset($raw);
			$allOrigNames[] = $file['name'];
			$uwxPeriods[] = ['fileName'=>$file['name'], 'from'=>$e['from'], 'to'=>$e['to'], 'key'=>$key, 'duration'=>$uwxDuration];
		}
		$uwxMerged = uwx_merge_files($fileRowsAll, $allOrigNames);
		unset($fileRowsAll);
		$canonicalHeader = $uwxMerged['header'];
		$mergedRows = $uwxMerged['rows'];
		unset($uwxMerged);
		$uwxC0 = uwx_process($canonicalHeader, array()); /* the required columns (Block, Facility, Month) */
	} catch(Exception $uwxErr){
		render_page($uwxErr->getMessage());
		exit;
	}
	$canonicalNorm = array_map('uwx_norm', $canonicalHeader);
	$idxBlock = $uwxC0['idxBlock'];
	$idxFac   = $uwxC0['idxFac'];
	$idxMonth = $uwxC0['idxMonth'];
	$idxOwner = $uwxC0['idxOwner'];
	$idxRU    = $uwxC0['idxRU'];
	$idxState = $uwxC0['idxState'];
	$idxDist  = $uwxC0['idxDist'];

	/* ==================================================================
	   (added) DQA Launcher State verification + District override
	   ------------------------------------------------------------------
	   dqa.php saved the id of the usage-log record and the State selected
	   on the launcher form in this same session (dqa_log_id / dqa_log_state).
	   Requirement:
	     - The uploaded file(s) must belong to the SAME State as selected.
	       (All month-wise files of one upload belong to the same State and
	       District, so the merged rows are checked as one dataset.)
	     - Mismatch  -> alert the user, DELETE that usage-log record (so only
	                    matching-State records are kept) and return the user
	                    to the dqa.php launcher. The upload is not processed.
	     - Match     -> keep the record and OVERRIDE its 'district' column
	                    with the District found in the uploaded file(s).
	   State/District are looked up first in their own columns of the merged
	   data (already located above as $idxState / $idxDist); if the State
	   column is absent or empty, the canonical header and the first merged
	   data rows are scanned for the selected State name (State can appear
	   anywhere in the files). If no District can be found, the District
	   recorded from the launcher form is left unchanged.
	   If the session carries no launcher record (e.g. logging beacon was
	   blocked), the upload proceeds exactly as before - nothing to verify.
	   Everything else about the upload flow is untouched.
	   ================================================================== */
	if ((isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch']) && !empty($_SESSION['dqa_launch']['state']))
		|| (!empty($_SESSION['dqa_log_id']) && !empty($_SESSION['dqa_log_state']))) {

		/* Same database as dqa.php (where dqa_usage_log lives). */
		$DQA_LOG_DB_HOST = 'localhost';
		$DQA_LOG_DB_NAME = 'epsvdwgx_reviewdatabase';
		$DQA_LOG_DB_USER = 'epsvdwgx_mainadmin';
		$DQA_LOG_DB_PASS = 'Ramkrishna$1210';

		/* Proper-use flow: launch details live in the session (no usage-log row
		   yet - it is written at the first Apply Filter). Legacy flow: a row was
		   already inserted at launch and its id is in the session. */
		$dqa_is_launch = (isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch']) && !empty($_SESSION['dqa_launch']['state']));
		$dqa_sel_state = $dqa_is_launch
			? trim((string)$_SESSION['dqa_launch']['state'])
			: trim((string)(isset($_SESSION['dqa_log_state']) ? $_SESSION['dqa_log_state'] : ''));
		$dqa_rec_id    = (!$dqa_is_launch && !empty($_SESSION['dqa_log_id'])) ? (int)$_SESSION['dqa_log_id'] : 0;

		/* Normalise a place name for tolerant comparison:
		   lower-case, '&' -> 'and', keep only letters/digits, single spaces. */
		$dqa_norm = function($s){
			$s = strtolower(trim((string)$s));
			$s = str_replace('&', ' and ', $s);
			$s = preg_replace('/[^a-z0-9]+/', ' ', $s);
			return trim(preg_replace('/\s+/', ' ', $s));
		};

		/* 1) State / District from their own columns (first non-empty value
		      across the merged rows of all uploaded files). */
		$dqa_file_state = '';
		$dqa_file_dist  = '';
		if ($idxState !== null) {
			foreach ($mergedRows as $r) {
				$v = trim((string)(isset($r[$idxState]) ? $r[$idxState] : ''));
				if ($v !== '') { $dqa_file_state = $v; break; }
			}
		}
		if ($idxDist !== null) {
			foreach ($mergedRows as $r) {
				$v = trim((string)(isset($r[$idxDist]) ? $r[$idxDist] : ''));
				if ($v !== '') { $dqa_file_dist = $v; break; }
			}
		}

		/* 2) Fallback: the State may appear anywhere in the file(s) (header
		      row or inside cells). Scan the canonical header and the first
		      merged data rows for the selected State name. */
		if ($dqa_file_state === '') {
			$dqa_needle = $dqa_norm($dqa_sel_state);
			$dqa_scan = array_merge(array($canonicalHeader), array_slice($mergedRows, 0, 50));
			foreach ($dqa_scan as $r) {
				if (!is_array($r)) continue;
				foreach ($r as $cell) {
					if ($dqa_needle !== '' && strpos($dqa_norm($cell), $dqa_needle) !== false) {
						$dqa_file_state = $dqa_sel_state; /* selected State found inside the file(s) */
						break 2;
					}
				}
			}
		}

		/* 3) Compare (tolerant): equal after normalising, or one name
		      contains the other (e.g. "NCT of Delhi" vs "Delhi"). */
		$dqa_a = $dqa_norm($dqa_file_state);
		$dqa_b = $dqa_norm($dqa_sel_state);
		$dqa_state_ok = ($dqa_a !== '' && $dqa_b !== '' &&
			($dqa_a === $dqa_b || strpos($dqa_a, $dqa_b) !== false || strpos($dqa_b, $dqa_a) !== false));

		if (!$dqa_state_ok) {
			/* Mismatch (or State not found in the file(s)): delete the
			   usage-log record so only matching-State records remain, then
			   alert the user and return them to the launcher. The upload is
			   NOT processed. */
			if ($dqa_rec_id > 0) { /* legacy flow only: a row was inserted at launch - remove it */
				try {
					$dqa_pdo = new PDO(
						'mysql:host=' . $DQA_LOG_DB_HOST . ';dbname=' . $DQA_LOG_DB_NAME . ';charset=utf8mb4',
						$DQA_LOG_DB_USER, $DQA_LOG_DB_PASS,
						array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3)
					);
					$dqa_st = $dqa_pdo->prepare('DELETE FROM dqa_usage_log WHERE id = :id LIMIT 1');
					$dqa_st->execute(array(':id' => $dqa_rec_id));
				} catch (Exception $e) { /* never surface DB errors to the user */ }
			}
			/* Proper-use flow: nothing was inserted, so nothing to delete - simply
			   discard the launch details: no output, no usage row. */
			unset($_SESSION['dqa_log_id'], $_SESSION['dqa_log_state'], $_SESSION['dqa_launch'], $_SESSION['dqa_launch_logid']);

			$dqa_msg = ($dqa_file_state === '')
				? 'The State could not be found in the uploaded file(s), so it cannot be verified against the State selected on the DQA Tools page (' . $dqa_sel_state . '). Please select the correct State on the DQA Tools page and upload the matching file(s).'
				: 'State mismatch: the uploaded file(s) belong to "' . $dqa_file_state . '", but "' . $dqa_sel_state . '" was selected on the DQA Tools page. Please select the correct State and upload the matching file(s).';
			echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>State mismatch</title></head><body>'
			   . '<script>alert(' . json_encode($dqa_msg) . '); window.location.replace("https://www.datamgmt.in/dqa.php");</script>'
			   . '<noscript><p>' . h($dqa_msg) . '</p><p><a href="https://www.datamgmt.in/dqa.php">Return to DQA Tools page</a></p></noscript>'
			   . '</body></html>';
			exit;
		}

		/* Match: override the record's District with the District found in
		   the uploaded file(s) (only when found). Best-effort and silent -
		   the analysis flow below continues exactly as before. */
		if ($dqa_file_dist !== '') {
			if ($dqa_rec_id > 0) { /* legacy flow: update the already-inserted row */
				try {
					$dqa_pdo = new PDO(
						'mysql:host=' . $DQA_LOG_DB_HOST . ';dbname=' . $DQA_LOG_DB_NAME . ';charset=utf8mb4',
						$DQA_LOG_DB_USER, $DQA_LOG_DB_PASS,
						array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3)
					);
					$dqa_st = $dqa_pdo->prepare('UPDATE dqa_usage_log SET district = :d WHERE id = :id LIMIT 1');
					$dqa_st->execute(array(':d' => substr(ucwords(strtolower($dqa_file_dist), " -.("), 0, 100), ':id' => $dqa_rec_id));
				} catch (Exception $e) { /* silent */ }
			} elseif (isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch'])) {
				/* Proper-use flow: keep the District found in the analysed file for
				   reference, but PRESERVE the launcher-form District untouched - it is
				   the agreed fallback whenever the file's District resolves to
				   'Multiple' (mixed values/spellings) at recording time. */
				$_SESSION['dqa_launch']['district_file'] = substr(ucwords(strtolower($dqa_file_dist), " -.("), 0, 100);
			}
		}
	} else {
		/* No launch details in this session - the tool was reached without the
		   dqa.php launch form (direct URL / bookmark / Back button) or the launch
		   beacon was lost. Proper-use logging requires the launch form, so the
		   upload is NOT processed: the user is returned to the DQA Tools page to
		   launch properly (State, District, Designation and Purpose). */
		$dqa_msg = 'Your launch details were not received, so this upload cannot be verified or recorded. Please open the tool again from the DQA Tools page and fill the launch form (State, District, Designation and Purpose).';
		echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Launch required</title></head><body>'
		   . '<script>alert(' . json_encode($dqa_msg) . '); window.location.replace("https://www.datamgmt.in/dqa.php");</script>'
		   . '<noscript><p>' . h($dqa_msg) . '</p><p><a href="https://www.datamgmt.in/dqa.php">Return to DQA Tools page</a></p></noscript>'
		   . '</body></html>';
		exit;
	}
	/* ============== end of added DQA launcher verification ============== */

	/* (changed 2026-11, web parity) rows stay in file order, as the web application reads them */
	$_SESSION['csv_header']=$canonicalHeader;
	$_SESSION['csv_norm']=$canonicalNorm;
	$_SESSION['csv_rows']=$mergedRows;
	$_SESSION['idxBlock']=$idxBlock;
	$_SESSION['idxFac']=$idxFac;
	$_SESSION['idxMonth']=$idxMonth;
	$_SESSION['idxOwner']=$idxOwner;
	$_SESSION['idxRU']=$idxRU;
	$_SESSION['idxState']=$idxState;
	$_SESSION['idxDist']=$idxDist;
	$_SESSION['uwx_periods']=$uwxPeriods;   /* (added 2026-11) declared From - To of every file */
	$_SESSION['uwx_duration']=$uwxDuration; /* (added 2026-11) WEEKLY / MONTHLY */
	$_SESSION['file_name']=implode(', ', $allOrigNames);
	$_SESSION['file_names']=$allOrigNames;
	/* (added) identity of this upload: pages and downloads built from it carry the id,
	   so data replaced later by another upload in this browser is detected */
	$_SESSION['dqa_upload_id'] = dqa_new_upload_id();
	$_SESSION['dqa_upload_tool'] = 'dqauwin';
	$_SESSION['dqa_upload_sig'] = dqa_data_sig();
	$_SESSION['dqa_hl'] = [];

	/* Default filters = the web application's U-WIN defaults; the analysis opens Sub
	   Center-wise (Facility-wise when the file has no Sub Center column) */
	$_SESSION['filters'] = [
		'blocks'=>[],
		'months'=>[],
		'ownership'=>[],
		'ru'=>[],
		'outliers_vax'=>uwx_outlier_vax(),
		'add_vax'=>[],
		'outliers_inc'=>['INC_EXT'],
		'outliers_drop'=>['DROP_EXT'],
		'drop_ranges'=>['R20P'],
		'drop_pairs'=>uwx_pair_defaults(),
		'drop_from'=>[],
		'drop_to'=>[],
		'incons_from'=>[],
		'incons_to'=>[],
		'active_group' => '',
		'analysis_mode' => uwx_standard_mode($uwxC0),
	];

	$_SESSION['hasApplied'] = false;
	$_SESSION['just_uploaded'] = true;
	render_results_with_data();
	exit;
}
elseif($action==='refresh'){
	if(!isset($_SESSION['csv_header'])){ render_page("Session expired. Please upload again."); exit; }
	$dqa_guard_msg = dqa_data_guard(isset($_POST['dqa_uid']) ? $_POST['dqa_uid'] : ''); /* (added) data replaced by another upload */
	if($dqa_guard_msg !== null){ render_page($dqa_guard_msg); exit; }

	$prev = isset($_SESSION['filters']) && is_array($_SESSION['filters']) ? $_SESSION['filters'] : [];

	/* Helper to keep previous if not posted (for persistence) */
	$keep_prev_array_if_missing = function($postKey, $prevKey) use ($prev){
		if(isset($_POST[$postKey])) return (array)$_POST[$postKey];
		return (isset($prev[$prevKey]) && is_array($prev[$prevKey])) ? $prev[$prevKey] : [];
	};
	/* For checkbox groups where an intentionally empty selection must not fall back to previous values */
	$get_posted_array_or_empty_when_present = function($postKey, $presentKey) use ($keep_prev_array_if_missing){
		if(isset($_POST[$presentKey])){
			return isset($_POST[$postKey]) ? (array)$_POST[$postKey] : [];
		}
		return $keep_prev_array_if_missing($postKey, $postKey);
	};

	/* Clean array values (remove empty) */
	$clean_nonempty = function($arr){
		$out = [];
		if(!is_array($arr)) $arr = (array)$arr;
		foreach($arr as $v){
			$v = trim((string)$v);
			if($v==='') continue;
			$out[] = $v;
		}
		return $out;
	};

	$_SESSION['filters'] = [
		'blocks' => isset($_POST['blocks']) ? (array)$_POST['blocks'] : [],
		'months' => isset($_POST['months']) ? (array)$_POST['months'] : [],
		'ownership' => isset($_POST['ownership']) ? (array)$_POST['ownership'] : [],
		'ru' => isset($_POST['ru']) ? (array)$_POST['ru'] : [],
		'outliers_vax' => isset($_POST['outliers_vax']) ? (array)$_POST['outliers_vax'] : [],
		'add_vax' => isset($_POST['add_vax']) ? (array)$_POST['add_vax'] : [],
		/* respect intentional empty selections for Outliers buckets */
		'outliers_inc' => $get_posted_array_or_empty_when_present('outliers_inc','outliers_inc_present'),
		'outliers_drop' => $get_posted_array_or_empty_when_present('outliers_drop','outliers_drop_present'),
		'drop_ranges' => isset($_POST['drop_ranges']) ? (array)$_POST['drop_ranges'] : [],
		'drop_pairs' => isset($_POST['drop_pairs']) ? (array)$_POST['drop_pairs'] : [],
		/* pair builder rows (index-wise) */
		/* (changed 2026-11, web parity) pair rows keep their position; an incomplete row is skipped */
		'drop_from' => isset($_POST['drop_from']) ? array_map('strval', (array)$_POST['drop_from']) : [],
		'drop_to' => isset($_POST['drop_to']) ? array_map('strval', (array)$_POST['drop_to']) : [],
		/* NEW: inconsistencies pair builder rows (index-wise) */
		'incons_from' => isset($_POST['incons_from']) ? array_map('strval', (array)$_POST['incons_from']) : [],
		'incons_to' => isset($_POST['incons_to']) ? array_map('strval', (array)$_POST['incons_to']) : [],
		'active_group' => isset($_POST['active_group']) ? (string)$_POST['active_group'] : (isset($prev['active_group']) ? (string)$prev['active_group'] : ''),
		'analysis_mode' => isset($_POST['analysis_mode']) ? (string)$_POST['analysis_mode'] : (isset($prev['analysis_mode']) ? (string)$prev['analysis_mode'] : ''), /* (added 2026-11) */
	];

	$_SESSION['hasApplied'] = true;
	unset($_SESSION['just_uploaded']);
	render_results_with_data();
	exit;
}
else{
	$_SESSION['exports']=[];
	$_SESSION['pink_fac_sets']=[];
	$_SESSION['pink_outlier_hits']=[];
	$_SESSION['pink_dropout_hits']=[];
	$_SESSION['allMonthsMap']=[];
	$_SESSION['drop_pair_map']=[];
	$_SESSION['incons_pair_map']=[];
	$_SESSION['pink_repeat_hits']=[];
	$_SESSION['hasApplied']=false;
	render_page();
	exit;
}

/* -------------------- Render: Landing -------------------- */
function render_page($msg=null){
	$APP_NAME = $GLOBALS['APP_NAME'];
?>
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title><?=h($APP_NAME)?></title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		:root{
			--ink:#0b1220;
			--muted:#475569;
			--glass:rgba(255,255,255,.78);
			--border:rgba(148,163,184,.45);
			--shadow:0 18px 46px rgba(2,6,23,.18);
			--avail:#2563eb; /* blue */
			--acc:#f97316;   /* orange */
			--cons:#22c55e;  /* green */
		}
		*{box-sizing:border-box}
		body{
			margin:0;min-height:100vh;color:var(--ink);
			font:15px/1.55 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
			background:
				radial-gradient(900px 520px at 12% 8%, rgba(251,191,36,.55), rgba(251,191,36,0) 60%),
				radial-gradient(820px 520px at 88% 18%, rgba(34,197,94,.45), rgba(34,197,94,0) 62%),
				radial-gradient(820px 520px at 55% 90%, rgba(34,211,238,.35), rgba(34,211,238,0) 58%),
				linear-gradient(135deg,#fff7ed 0%, #ecfeff 35%, #f0fdf4 100%) fixed;
		}
		.container{max-width:1040px;margin:0 auto;padding:42px 18px}
		.header{display:flex;gap:16px;align-items:center;justify-content:center;margin-top:18px}
		.logo{
			width:66px;height:66px;border-radius:22px;
			background:linear-gradient(135deg,#22c55e,#f59e0b);
			box-shadow:0 18px 44px rgba(34,197,94,.26);
			display:grid;place-items:center;color:#fff;font-weight:1000;font-size:18px;letter-spacing:.6px
		}
		.title{text-align:center}
		.title h1{margin:8px 0 4px;font-size:30px;font-weight:1000;letter-spacing:.2px;color:#0f172a}
		.title p{margin:0;color:#0f172acc;font-weight:800}
		.card{
			margin:28px auto 0;border-radius:26px;padding:0;
			background:var(--glass);
			backdrop-filter: blur(10px);
			box-shadow:var(--shadow);
			overflow:hidden;border:1px solid rgba(255,255,255,.7);
		}
		.cardHeader{
			background:linear-gradient(90deg,rgba(34,197,94,.95),rgba(245,158,11,.92));
			padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.6)
		}
		.cardHeader h3{margin:0;color:#052e16;font-weight:1000}
		.cardInner{padding:20px}
		.formRow{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
		label{font-weight:900;color:#0f172a}
		input[type=file]{
			background:#fff;border:1px solid rgba(148,163,184,.55);
			border-radius:14px;padding:12px;width:100%;
			box-shadow:0 2px 0 rgba(2,6,23,.03), 0 10px 22px rgba(2,6,23,.08);
		}
		button{
			display:inline-block;border:0;border-radius:14px;padding:12px 16px;font-weight:1000;color:#052e16;cursor:pointer;text-decoration:none;
			background:linear-gradient(135deg,#fef3c7,#bbf7d0);
			box-shadow:0 12px 26px rgba(2,6,23,.18);
			transition: transform .08s ease, box-shadow .2s ease, filter .2s ease;
		}
		button:hover{ transform: translateY(-1px); filter:brightness(1.03); box-shadow:0 14px 30px rgba(2,6,23,.22) }
		button:active{ transform: translateY(0) }
		.kpiRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px}
		.kpi{
			background:rgba(255,255,255,.92);
			border:1px solid rgba(148,163,184,.45);
			border-radius:16px;
			padding:12px 12px 14px;
			box-shadow:0 10px 22px rgba(2,6,23,.08);
		}
		.kpi h3{margin:0 0 8px;font-size:14px;font-weight:1000}
		.kpi .muted{font-size:12.5px;color:#334155;font-weight:650;line-height:1.35}
		.kpi.kpiAvail h3{color:var(--avail)}
		.kpi.kpiAcc h3{color:var(--acc)}
		.kpi.kpiCons h3{color:var(--cons)}
		.msg{
			color:#991b1b;margin-top:16px;font-weight:1000;text-align:center;font-size:16px;padding:10px 14px;border-radius:14px;
			background:rgba(254,226,226,.95);border:1px solid rgba(248,113,113,.35)
		}
		.footer{margin:16px auto 0;text-align:center;color:#0f172ab3;font-weight:750;font-size:13px}
	</style>
</head>
<body>
	<div class="container">
		<div style="text-align:right;margin-bottom:6px"><button type="button" onclick="window.location.href='?dqa_logout=1';" title="Return to the DQA Tools page and remove your uploaded data from the server">Logout</button></div>
		<div class="header">
			<div class="logo">UWIN</div>
			<div class="title">
				<h1><?=h($APP_NAME)?></h1>
				<p>Upload UWIN CSV and generate a precise desk review instantly</p>
			</div>
		</div>

		<div class="card">
			<div class="cardHeader"><h3>Upload CSV (first row = headers)</h3></div>
			<div class="cardInner">
				<form method="post" enctype="multipart/form-data">
					<input type="hidden" name="action" value="upload">
					<input type="hidden" name="access_code" value="<?=h($GLOBALS['ACCESS_CODE_CURRENT'])?>">
					<div class="formRow">
						<div style="flex:1 1 520px">
								<?php /* (changed 2026-11, web parity) Weekly / Monthly and the From - To dates of every file, as in the DQA web application */ ?>
								<label>The files cover</label>
								<div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 12px">
									<label style="display:flex;gap:8px;align-items:center;background:#fff;border:1px solid rgba(148,163,184,.55);border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer"><input type="radio" name="uwx_duration" value="MONTHLY" required> Monthly <span style="font-weight:600;color:#475569">(28 to 31 days per file, up to 12 files)</span></label>
									<label style="display:flex;gap:8px;align-items:center;background:#fff;border:1px solid rgba(148,163,184,.55);border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer"><input type="radio" name="uwx_duration" value="WEEKLY"> Weekly <span style="font-weight:600;color:#475569">(exactly 7 days per file, up to 4 files)</span></label>
								</div>
								<label>Select U-WIN CSV file(s). Use the Ctrl key to select several files.</label>
								<input type="file" id="csv_files" name="csv_files[]" accept=".csv" multiple required>
								<div id="periodMap" style="margin-top:10px"></div>
								<div id="periodMsg" style="display:none;margin-top:8px;color:#991b1b;font-weight:800;font-size:13px"></div>
								<div style="color:#475569;font-size:13px;margin-top:8px">
									Enter the <b>From</b> and <b>To</b> date each file covers (the dates the U-WIN report was taken for). A monthly file is analysed as the calendar month holding most of its days (20 Apr &ndash; 20 May is May). Files must follow one another, with no gap or overlap, and no date may be after today.
								</div>
								<script>
								(function(){
									var TODAY = <?=json_encode(uwx_today())?>;
									var inp = document.getElementById('csv_files');
									var map = document.getElementById('periodMap');
									var msg = document.getElementById('periodMsg');
									if(!inp || !map) return;
									var form = inp.form;
									var MON3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
									var MONF = ['january','february','march','april','may','june','july','august','september','october','november','december'];
									var MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
									function pad(n){ return (n < 10 ? '0' : '') + n; }
									function dur(){ var r = form.querySelector('input[name="uwx_duration"]:checked'); return r ? r.value : ''; }
									function monthEnd(ym){ var p = ym.split('-'); return ym + '-' + pad(new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate()); }
									function addDays(iso, d){ var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + d)).toISOString().slice(0, 10); }
									function days(a, b){ var x = a.split('-'), y = b.split('-'); return Math.round((Date.UTC(+y[0], +y[1] - 1, +y[2]) - Date.UTC(+x[0], +x[1] - 1, +x[2])) / 86400000) + 1; }
									function dayLabel(iso){ var p = iso.split('-'); return (+p[2]) + ' ' + MONS[+p[1] - 1] + ' ' + p[0]; }
									/* the month in a file name, as the web application guesses it (csvParser.ts extractMonthFromFilename) */
									function fileMonth(name){
										var b = name.replace(/\.[^.]+$/, '').replace(/[_\-\s]+/g, ' ').toLowerCase(), m;
										m = b.match(/\b((?:19|20)\d{2})\s+(\d{2})\b/); if(m && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + pad(+m[2]);
										m = b.match(/\b(\d{1,2})\s+((?:19|20)\d{2})\b/); if(m && +m[1] >= 1 && +m[1] <= 12) return m[2] + '-' + pad(+m[1]);
										var yf = b.match(/\b((?:19|20)\d{2})\b/), y = yf ? +yf[1] : null;
										if(!yf){ var ys = b.match(/\b(\d{2})\b/); y = ys ? 2000 + (+ys[1]) : null; }
										if(!y) return null;
										for(var i = 0; i < 12; i++){ if(b.indexOf(MONF[i]) >= 0 || b.indexOf(MON3[i]) >= 0) return y + '-' + pad(i + 1); }
										return null;
									}
									/* To date for a newly picked From date (uploadPeriod.ts suggestedPeriodEnd) */
									function suggestedEnd(d, from){
										if(d === 'WEEKLY') return addDays(from, 6);
										if(from.slice(8) === '01') return monthEnd(from.slice(0, 7));
										var p = from.split('-'), ny = (+p[1] === 12) ? (+p[0] + 1) : +p[0], nm = (+p[1] === 12) ? 1 : (+p[1] + 1);
										var nym = ny + '-' + pad(nm), last = +monthEnd(nym).slice(8);
										return addDays(nym + '-' + pad(Math.min(+p[2], last)), -1);
									}
									function fits(d, from, to){ if(!from || !to || from > to) return false; var n = days(from, to); return d === 'WEEKLY' ? n === 7 : (n >= 28 && n <= 31); }
									function rebuild(){
										msg.style.display = 'none';
										map.innerHTML = '';
										var files = inp.files;
										if(!files || !files.length) return;
										var d = dur();
										var t = document.createElement('table');
										t.style.width = '100%'; t.style.borderCollapse = 'collapse';
										t.innerHTML = '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">File</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">From</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">To</th></tr></thead>';
										var tb = document.createElement('tbody');
										for(var i = 0; i < files.length; i++){
											var tr = document.createElement('tr');
											var td = document.createElement('td'); td.style.padding = '6px 8px'; td.style.borderBottom = '1px solid #f1f5f9'; td.textContent = files[i].name; tr.appendChild(td);
											var fm = (d === 'MONTHLY') ? fileMonth(files[i].name) : null;
											var from = fm ? fm + '-01' : '', to = fm ? monthEnd(fm) : '';
											['file_from[]', 'file_to[]'].forEach(function(nm, k){
												var c = document.createElement('td'); c.style.padding = '6px 8px'; c.style.borderBottom = '1px solid #f1f5f9';
												var e = document.createElement('input'); e.type = 'date'; e.name = nm; e.max = TODAY; e.required = true;
												e.value = k === 0 ? from : to;
												e.style.padding = '9px 10px'; e.style.border = '1px solid #e2e8f0'; e.style.borderRadius = '10px';
												c.appendChild(e); tr.appendChild(c);
											});
											(function(row){
												var a = row.querySelector('input[name="file_from[]"]'), b = row.querySelector('input[name="file_to[]"]');
												a.addEventListener('change', function(){ var dd = dur(); if(a.value && dd && (dd === 'WEEKLY' || !fits(dd, a.value, b.value))) b.value = suggestedEnd(dd, a.value); });
												b.addEventListener('change', function(){ if(b.value && dur() === 'WEEKLY') a.value = addDays(b.value, -6); });
											})(tr);
											tb.appendChild(tr);
										}
										t.appendChild(tb);
										map.appendChild(t);
									}
									/* the rules of uploadPeriod.ts, checked before the files are sent (the server checks them again) */
									function problems(){
										var d = dur(), rows = map.querySelectorAll('tbody tr'), list = [];
										if(!d) return 'Please choose whether the files are weekly or monthly.';
										var maxF = d === 'WEEKLY' ? 4 : 12;
										if(rows.length > maxF) return (d === 'WEEKLY' ? 'Weekly' : 'Monthly') + ' uploads take at most ' + maxF + ' files (' + (d === 'WEEKLY' ? 'one per week' : 'one per month') + '). You selected ' + rows.length + '.';
										for(var i = 0; i < rows.length; i++){
											var nm = rows[i].cells[0].textContent, a = rows[i].querySelector('input[name="file_from[]"]').value, b = rows[i].querySelector('input[name="file_to[]"]').value;
											if(!a || !b) return nm + ': Enter both a From date and a To date.';
											if(a > b) return nm + ': The From date must be on or before the To date.';
											if(b > TODAY) return nm + ': Dates cannot be in the future. The latest allowed date is today, ' + dayLabel(TODAY) + '.';
											if(!fits(d, a, b)) return nm + ': ' + (d === 'WEEKLY' ? 'A weekly file must cover exactly 7 days. ' : 'A monthly file must cover 28 to 31 days. ') + 'This window covers ' + days(a, b) + ' day' + (days(a, b) === 1 ? '' : 's') + '.';
											list.push({ n: nm, a: a, b: b });
										}
										list.sort(function(x, y){ return x.a < y.a ? -1 : (x.a > y.a ? 1 : (x.b < y.b ? -1 : 1)); });
										for(var j = 1; j < list.length; j++){
											if(list[j].a <= list[j - 1].b) return '"' + list[j - 1].n + '" and "' + list[j].n + '" overlap. Each file must cover different days.';
											if(list[j].a !== addDays(list[j - 1].b, 1)) return '"' + list[j - 1].n + '" and "' + list[j].n + '" are not consecutive. Each file must start the day after the previous one ends.';
										}
										return '';
									}
									inp.addEventListener('change', rebuild);
									Array.prototype.forEach.call(form.querySelectorAll('input[name="uwx_duration"]'), function(r){ r.addEventListener('change', rebuild); });
									form.addEventListener('submit', function(ev){
										var p = problems();
										if(p){ ev.preventDefault(); msg.textContent = p; msg.style.display = 'block'; }
									});
								})();
								</script>
							<div style="color:#475569;font-size:15px;margin-top:8px">
								UIP Reports->Coverage->Session Site data to be downloaded from UWIN Portal.
								
<a href="https://uwin.mohfw.gov.in/" target="_blank">UWIN Portal</a>
							</div>
						</div>
						<div style="flex:0 0 auto">
							<button type="submit">Upload & Analyse</button>
						</div>
					</div>

					<div class="kpiRow">
						<div class="kpi kpiAvail"><h3>Availability</h3><div class="muted">All reports for the study period must be available in the portal at the time of assessment</div></div>
						<div class="kpi kpiAcc"><h3>Accuracy</h3><div class="muted">Identification of logical errors and outliers in immunization data of UWIN portal</div></div>
						<div class="kpi kpiCons"><h3>Consistency</h3><div class="muted">Identification of discrepencies as per immunization logics</div></div>
					</div>
				</form>

				<?php if($msg): ?><div class="msg"><?=h($msg)?></div><?php endif; ?>
				<div class="footer">Your file is processed temporarily and is not saved on the server.</div>
			</div>
		</div>
	</div>
<?php dqa_idle_script(); ?>
</body>
</html>
<?php
}

/* -------------------- Table renderers -------------------- */
function render_table($rows, $highlightN, $ynNote=''){ /* (changed) optional Y/N legend under the table */
	if(empty($rows) || !is_array($rows)){
		echo "<div style='padding:12px'>No data.</div>";
		return;
	}
	echo "<div class='tblWrap'>";
	echo "<table>";
	$head = $rows[0];
	echo "<tr>";
	foreach($head as $hcell){
		echo "<th>".h($hcell)."</th>";
	}
	echo "</tr>";
	for($i=1;$i<count($rows);$i++){
		echo "<tr>";
		$r = $rows[$i];
		$colCount = count($head);
		for($c=0;$c<$colCount;$c++){
			$v = isset($r[$c]) ? (string)$r[$c] : '';
			$cls = "";
			/* (changed) Y = no issue -> light green; N = issue -> light red (bold) */
			if($highlightN && $v === 'Y') $cls = " class='nCell'";
			if($highlightN && $v === 'N') $cls = " class='issueCell'";
			echo "<td{$cls}>".h($v)."</td>";
		}
		echo "</tr>";
	}
	echo "</table>";
	if($highlightN && $ynNote!=='') echo dqa_yn_note($ynNote); /* (added) legend under the Y/N table */
	echo "</div>";
}
function render_missing_indicator_two_level($t2_web){
	$vaccines = $t2_web['vaccines'];
	$months = $t2_web['months'];
	$monthLabels = $t2_web['monthLabels'];
	$rows = $t2_web['rows'];
	$highlightN = !empty($t2_web['highlightN']);

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($vaccines as $vx){
		echo "<th class='lvl1' colspan='".(int)count($months)."'>".h(display_vax_label($vx))."</th>";
	}
	echo "</tr>";
	echo "<tr>";
	foreach($vaccines as $vx){
		foreach($months as $mk){
			$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
			echo "<th class='lvl2'>".h($ml)."</th>";
		}
	}
	echo "</tr>";
	foreach($rows as $rk=>$row){
		echo "<tr>";
		dqa_id_td($row['block'], $row['facility'], isset($row['sessionsite']) ? $row['sessionsite'] : '');
		foreach($vaccines as $vx){
			foreach($months as $mk){
				$val = isset($row['cells'][$vx][$mk]) ? (string)$row['cells'][$vx][$mk] : '';
				/* (changed) Y = no issue -> light green; N = issue -> light red (bold) */
				$cls = ($highlightN && $val==='Y') ? " class='nCell'" : (($highlightN && $val==='N') ? " class='issueCell'" : "");
				echo "<td{$cls}>".h($val)."</td>";
			}
		}
		echo "</tr>";
	}
	echo "</table>";
	if($highlightN && isset($t2_web['ynNote']) && $t2_web['ynNote']!=='') echo dqa_yn_note($t2_web['ynNote']); /* (added) legend under the Y/N table */
	echo "</div>";
}

/* Avg Beneficiaries/Session < 5 table: two-level month headers (Month -> Held/Beneficiaries/Average) */
function render_beneficiaries_avg_two_level($t8_web){
	$months = isset($t8_web['months']) ? $t8_web['months'] : [];
	$monthLabels = isset($t8_web['monthLabels']) ? $t8_web['monthLabels'] : [];
	$rows = isset($t8_web['rows']) ? $t8_web['rows'] : [];

	// Append "All months" group at the end
	$monthsAll = $months;
	$monthsAll[] = '__ALL__';
	$monthLabels['__ALL__'] = 'All months';

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($monthsAll as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='3'>".h($ml)."</th>";
	}
	echo "</tr>";
	echo "<tr>";
	foreach($monthsAll as $mk){
		echo "<th class='lvl2'>Session Held</th>";
		echo "<th class='lvl2'>Beneficiaries</th>";
		echo "<th class='lvl2'>Average</th>";
	}
	echo "</tr>";

	foreach($rows as $fkey=>$r){
		echo "<tr>";
		dqa_id_td($r['block'], $r['facility'], isset($r['sessionsite']) ? $r['sessionsite'] : '');
		$cells = isset($r['cells']) ? $r['cells'] : [];
		$tot = isset($r['totals']) ? $r['totals'] : ['held'=>null,'ben'=>null,'avg'=>null];

		foreach($months as $mk){
			$ci = isset($cells[$mk]) ? $cells[$mk] : ['held'=>null,'ben'=>null,'avg'=>null,'flag'=>false];
			$show = !empty($ci['flag']);
			$held = ($show && $ci['held']!==null ? round($ci['held']) : '');
			$ben  = ($show && $ci['ben']!==null  ? round($ci['ben'])  : '');
			$avg  = ($show && $ci['avg']!==null  ? round($ci['avg'],1): '');
			echo "<td>".h((string)$held)."</td>";
			echo "<td>".h((string)$ben)."</td>";
			echo "<td>".h((string)$avg)."</td>";
		}

		$totFlag = !empty($tot['flag']);
		$heldT = ($totFlag && $tot['held']!==null ? round($tot['held']) : '');
		$benT  = ($totFlag && $tot['ben']!==null  ? round($tot['ben'])  : '');
		$avgT  = ($totFlag && $tot['avg']!==null  ? round($tot['avg'],1): '');
		echo "<td>".h((string)$heldT)."</td>";
		echo "<td>".h((string)$benT)."</td>";
		echo "<td>".h((string)$avgT)."</td>";

		echo "</tr>";
	}
	echo "</table></div>";
}
/* NEW: Planned but not held table — two-level month headers (Month -> Sessions Planned / Sessions Held / % not held),
   same layout style as the Outliers table; cells filled only for violating months (Held < Planned). */
function render_planned_not_held_two_level($t6_web){
	$months = isset($t6_web['months']) ? $t6_web['months'] : [];
	$monthLabels = isset($t6_web['monthLabels']) ? $t6_web['monthLabels'] : [];
	$rows = isset($t6_web['rows']) ? $t6_web['rows'] : [];

	// Append "All months" group at the end
	$monthsAll = $months;
	$monthsAll[] = '__ALL__';
	$monthLabels['__ALL__'] = 'All months';

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($monthsAll as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='3'>".h($ml)."</th>";
	}
	echo "</tr>";
	echo "<tr>";
	foreach($monthsAll as $mk){
		echo "<th class='lvl2'>Sessions Planned</th>";
		echo "<th class='lvl2'>Sessions Held</th>";
		echo "<th class='lvl2'>% not held</th>";
	}
	echo "</tr>";

	foreach($rows as $fkey=>$r){
		echo "<tr>";
		dqa_id_td($r['block'], $r['facility'], isset($r['sessionsite']) ? $r['sessionsite'] : '');
		$cells = isset($r['cells']) ? $r['cells'] : [];
		$tot = isset($r['totals']) ? $r['totals'] : ['p'=>null,'h'=>null,'pct'=>null,'hit'=>false];

		foreach($months as $mk){
			$ci = isset($cells[$mk]) ? $cells[$mk] : ['p'=>null,'h'=>null,'pct'=>null,'hit'=>false];
			if(empty($ci['hit'])){
				echo "<td></td><td></td><td></td>";
			} else {
				echo "<td>".h((string)($ci['p']===null?'':round($ci['p'])))."</td>";
				echo "<td>".h((string)($ci['h']===null?'':round($ci['h'])))."</td>";
				echo "<td>".h(($ci['pct']===null?'':round($ci['pct'],1).'%'))."</td>";
			}
		}

		if(empty($tot['hit'])){
			echo "<td></td><td></td><td></td>";
		} else {
			echo "<td>".h((string)($tot['p']===null?'':round($tot['p'])))."</td>";
			echo "<td>".h((string)($tot['h']===null?'':round($tot['h'])))."</td>";
			echo "<td>".h(($tot['pct']===null?'':round($tot['pct'],1).'%'))."</td>";
		}
		echo "</tr>";
	}
	echo "</table></div>";
}
/** Outliers table: Month1 value | Month2 value | % Change */
function render_outliers_two_level($t3_web){
	$vaccines = $t3_web['vaccines'];
	$pairs = $t3_web['pairs'];
	$rows = $t3_web['rows'];

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($vaccines as $vx){
		echo "<th class='lvl1' colspan='".(int)(count($pairs)*3)."'>".h(display_vax_label($vx))."</th>";
	}
	echo "</tr>";
	echo "<tr>";
	foreach($vaccines as $vx){
		foreach($pairs as $p){
			$m1l = $p['m1lbl']; $m2l = $p['m2lbl'];
			echo "<th class='lvl2'>".h($m1l)."</th>";
			echo "<th class='lvl2'>".h($m2l)."</th>";
			echo "<th class='lvl2'>% Change</th>";
		}
	}
	echo "</tr>";
	foreach($rows as $rk=>$row){
		echo "<tr>";
		dqa_id_td($row['block'], $row['facility'], isset($row['sessionsite']) ? $row['sessionsite'] : '');
		foreach($vaccines as $vx){
			foreach($pairs as $p){
				$pk = $p['k'];
				$cell = (isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk])) ? $row['cells'][$vx][$pk] : null;
				if(!$cell || empty($cell['hit'])){
					echo "<td></td><td></td><td></td>";
				} else {
					$a = $cell['a']; $b = $cell['b']; $pct = $cell['pct'];
					$pctStr = !empty($cell['fromZero']) ? 'from 0' : (($pct===null) ? '' : (($pct>0?'+':'').round($pct,1).'%'));
					echo "<td>".h($a===null?'':round($a))."</td>";
					echo "<td>".h($b===null?'':round($b))."</td>";
					echo "<td>".h($pctStr)."</td>";
				}
			}
		}
		echo "</tr>";
	}
	echo "</table></div>";
}
function render_dropouts_pair_two_level($web){
	$from = $web['from'];
	$to = $web['to'];
	$months = $web['months'];
	$monthLabels = $web['monthLabels'];
	$rows = $web['rows'];

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($months as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='3'>".h($ml)."</th>";
	}
	echo "<th class='lvl1' colspan='3'>All months</th>";
	echo "</tr>";
	echo "<tr>";
	foreach($months as $mk){
		echo "<th class='lvl2'>".h(display_vax_label($from))."</th>";
		echo "<th class='lvl2'>".h(display_vax_label($to))."</th>";
		echo "<th class='lvl2'>% Dropouts</th>";
	}
	echo "<th class='lvl2'>".h(display_vax_label($from))."</th>";
	echo "<th class='lvl2'>".h(display_vax_label($to))."</th>";
	echo "<th class='lvl2'>% Dropouts</th>";
	echo "</tr>";

	foreach($rows as $rk=>$row){
		echo "<tr>";
		dqa_id_td($row['block'], $row['facility'], isset($row['sessionsite']) ? $row['sessionsite'] : '');
		foreach($months as $mk){
			$cell = isset($row['cells'][$mk]) ? $row['cells'][$mk] : ['from'=>null,'to'=>null,'pct'=>null];
			$a = $cell['from']; $b = $cell['to']; $p = $cell['pct'];
			echo "<td>".h($a===null?'':round($a))."</td>";
			echo "<td>".h($b===null?'':round($b))."</td>";
			echo "<td>".h($p===null?'':round($p,1).'%')."</td>";
		}
		$all = isset($row['all']) ? $row['all'] : ['from'=>null,'to'=>null,'pct'=>null];
		echo "<td>".h($all['from']===null?'':round($all['from']))."</td>";
		echo "<td>".h($all['to']===null?'':round($all['to']))."</td>";
		echo "<td>".h($all['pct']===null?'':round($all['pct'],1).'%')."</td>";
		echo "</tr>";
	}
	echo "</table></div>";
}
/* NEW (Consistency coloring rule):
   When values within a co-admin group disagree (e.g., 3 vaccines same and 2 vaccines same
   but different from the 3, or vice versa), color RED the cells OTHER THAN the Penta vaccine,
   i.e., cells whose value differs from the Penta value (Penta is the reference and is never colored).
   For groups without a Penta vaccine (9 months / 2 years), cells differing from the majority
   value are colored red; when there is no majority (all values disagree), all cells are colored red. */
function coadmin_red_cells($valsByVx){
	/* $valsByVx: vaccineShort => normalized value key (only non-null values included) */
	$red = [];
	if(count($valsByVx) < 2) return $red;
	$counts = [];
	foreach($valsByVx as $vx=>$k){ $counts[$k] = isset($counts[$k]) ? $counts[$k] + 1 : 1; }
	if(count($counts) <= 1) return $red; /* all values equal: no violation, no coloring */

	/* Penta reference value (Penta1/Penta2/Penta3) if present in this group */
	$pentaKey = null;
	foreach($valsByVx as $vx=>$k){
		if(stripos((string)$vx, 'penta') === 0){ $pentaKey = $k; break; }
	}
	if($pentaKey !== null){
		foreach($valsByVx as $vx=>$k){
			if(stripos((string)$vx, 'penta') === 0) continue; /* never color Penta cells */
			if($k !== $pentaKey) $red[$vx] = true;
		}
		return $red;
	}

	/* No Penta in this group: color cells differing from the majority value */
	$modeK = null; $modeC = -1; $tie = false;
	foreach($counts as $k=>$c){
		if($c > $modeC){ $modeC = $c; $modeK = $k; $tie = false; }
		elseif($c === $modeC){ $tie = true; }
	}
	if($tie || $modeC <= 1){
		foreach($valsByVx as $vx=>$k){ $red[$vx] = true; }
		return $red;
	}
	foreach($valsByVx as $vx=>$k){ if($k !== $modeK) $red[$vx] = true; }
	return $red;
}
function render_coadmin_two_level($web){
	$vaccines = $web['vaccines'];
	$months = $web['months'];
	$monthLabels = $web['monthLabels'];
	$rows = $web['rows'];

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	dqa_id_th();
	foreach($months as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='".(int)count($vaccines)."'>".h($ml)."</th>";
	}
	echo "<th class='lvl1' colspan='".(int)count($vaccines)."'>All months</th>";
	echo "</tr>";
	echo "<tr>";
	foreach($months as $mk){
		foreach($vaccines as $vx){ echo "<th class='lvl2'>".h(display_vax_label($vx))."</th>"; }
	}
	foreach($vaccines as $vx){ echo "<th class='lvl2'>".h(display_vax_label($vx))."</th>"; }
	echo "</tr>";

	foreach($rows as $rk=>$row){
		echo "<tr>";
		dqa_id_td($row['block'], $row['facility'], isset($row['sessionsite']) ? $row['sessionsite'] : '');

		/* (changed 2026-10) red = the cells found by the analysis for a month that differs
		   (same cells as the dark pink of the highlighted download); totals = reference only */
		foreach($months as $mk){
			$dqa_mask = isset($row['red'][$mk]) ? (int)$row['red'][$mk] : 0;
			foreach($vaccines as $dqa_vi=>$vx){
				$v = isset($row['vals'][$mk][$vx]) ? $row['vals'][$mk][$vx] : null;
				$cls = ($v !== null && ($dqa_mask & (1 << $dqa_vi))) ? " class='redCell'" : "";
				echo "<td{$cls}>".h($v===null?'':round($v))."</td>";
			}
		}

		foreach($vaccines as $vx){
			$tv = isset($row['totals'][$vx]) ? $row['totals'][$vx] : null;
			echo "<td>".h($tv===null?'':round($tv))."</td>";
		}
		echo "</tr>";
	}
	echo "</table></div>";
}

/* -------------------- Render: Results -------------------- */

function render_results_with_data(){
	$APP_NAME = $GLOBALS['APP_NAME'];
	$BASE_URL = $GLOBALS['BASE_URL'];

	$header = $_SESSION['csv_header'];
	$rows = $_SESSION['csv_rows'];
	$filters = isset($_SESSION['filters']) ? $_SESSION['filters'] : [];
	$fileName = isset($_SESSION['file_name']) ? $_SESSION['file_name'] : 'uploaded.csv';
	$hasApplied = isset($_SESSION['hasApplied']) ? (bool)$_SESSION['hasApplied'] : false;
	$justUploaded = !empty($_SESSION['just_uploaded']);
	unset($_SESSION['just_uploaded']);
	/* the download data of the previous page is rebuilt below: release it first, so large files
	   stay within the memory limit */
	$_SESSION['exports'] = [];
	$_SESSION['dqa_hl'] = [];
	$_SESSION['pink_fac_sets'] = []; $_SESSION['pink_outlier_hits'] = []; $_SESSION['pink_dropout_hits'] = []; $_SESSION['pink_repeat_hits'] = [];

	/* (changed 2026-11, web parity) The analysis is the DQA web application's U-WIN analysis
	   (web parity engine above): units at the selected level - Facility-wise, Sub Center-wise
	   (the default, as in the web application) or Session Site-wise - every check, its rules and
	   its counts. The screens, tables and downloads below show its results. */
	$uwxC = uwx_process($header, $rows);
	$idxMonth = $uwxC['idxMonth'];
	$stdMode = uwx_standard_mode($uwxC);
	$uwxModes = ['facility'=>'Facility-wise'];
	if($uwxC['idxSubCenter'] !== null) $uwxModes['subcenter'] = 'Sub Center-wise';
	if($uwxC['idxSessionSite'] !== null) $uwxModes['sessionsite'] = 'Session Site-wise';
	$uwxMode = (isset($filters['analysis_mode']) && isset($uwxModes[(string)$filters['analysis_mode']])) ? (string)$filters['analysis_mode'] : $stdMode;
	$GLOBALS['DQA_MODE'] = $uwxMode;
	$unitPlural = ['facility'=>'facilities', 'subcenter'=>'sub centers', 'sessionsite'=>'session sites'][$uwxMode];
	$unitTitle = ['facility'=>'Facilities', 'subcenter'=>'Sub Centers', 'sessionsite'=>'Session Sites'][$uwxMode];

	$BASE_VAX = ['BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2'];
	$ADD_VAX = ['RVV1','RVV2','RVV3','IPV1','IPV2','IPV3','PCV1','PCV2','PCV Booster','HepB0','DPT 1st Booster'];
	$KEY_VAX = $BASE_VAX;
	$PAIR_DEFAULTS = array_merge(uwx_pair_defaults(), ['BCG→MR1']); /* pairs offered as ticks; only the 3 standard pairs are scored */

	/* Option sets */
	$allMonths = [];
	foreach($uwxC['allMonths'] as $mk=>$lbl){ $allMonths[$mk] = uwx_month_year_label($mk); }
	$allBlocks = [];
	foreach($uwxC['facilityData'] as $u){ $allBlocks[$u['block']] = true; }
	ksort($allBlocks, SORT_NATURAL|SORT_FLAG_CASE);
	$_SESSION['allMonthsMap'] = $allMonths;
	$monthKeys = array_keys($allMonths);
	$singleMonthDataset = (count($monthKeys) === 1);
	$showOutliersDropdown = (count($monthKeys) > 1);
	$showDropoutsDropdown = (count($monthKeys) > 1); /* no dropout for one month or one week */

	/* Filters: the selections on screen, as the web application reads them */
	$arr = function($k) use ($filters){ return (isset($filters[$k]) && is_array($filters[$k])) ? array_values($filters[$k]) : []; };
	$mSel = []; foreach($arr('months') as $mk){ if(isset($allMonths[(string)$mk])) $mSel[] = (string)$mk; }
	$bSel = []; foreach($arr('blocks') as $b){ if(isset($allBlocks[(string)$b])) $bSel[] = (string)$b; }
	if(count($bSel) === count($allBlocks)) $bSel = [];
	$ovSel = []; foreach($arr('outliers_vax') as $v){ if(in_array((string)$v, $KEY_VAX, true)) $ovSel[] = (string)$v; }
	$avSel = []; foreach($arr('add_vax') as $v){ if(in_array((string)$v, $ADD_VAX, true)) $avSel[] = (string)$v; }
	$filters['blocks'] = $bSel; $filters['months'] = $mSel;
	$filters['outliers_vax'] = !empty($ovSel) ? $ovSel : uwx_outlier_vax();
	$filters['add_vax'] = $avSel;
	foreach(['outliers_inc','outliers_drop','drop_ranges','drop_pairs','drop_from','drop_to','incons_from','incons_to'] as $k){ $filters[$k] = array_map('strval', $arr($k)); }
	$filters['active_group'] = isset($filters['active_group']) ? (string)$filters['active_group'] : '';
	$filters['analysis_mode'] = $uwxMode;
	$_SESSION['filters'] = $filters;
	$uwxF = [
		'blocks'=>$bSel, 'months'=>$mSel, 'ownership'=>[], 'ru'=>[], 'analysisMode'=>$uwxMode,
		'outliersVax'=>$filters['outliers_vax'], 'addVax'=>$avSel,
		'outliersInc'=>$filters['outliers_inc'], 'outliersDrop'=>$filters['outliers_drop'],
		'dropRanges'=>$filters['drop_ranges'], 'dropPairs'=>$filters['drop_pairs'],
		'dropFrom'=>$filters['drop_from'], 'dropTo'=>$filters['drop_to'],
		'inconsFrom'=>$filters['incons_from'], 'inconsTo'=>$filters['incons_to'],
	];
	$R = uwx_compute_with_score($uwxC, $uwxF);

	$facFiltered = $R['units'];
	$selDen = (int)$R['den'];
	$selBlocksCount = (int)$R['blocksSel'];
	$selMonthKeysOrdered = $R['selMonths'];
	$selMonthLabelsOrdered = $R['labels'];
	$globalBlocksCount = (int)$uwxC['globalBlockCount'];
	$globalDen = (int)$uwxC['globalFacilityCount'];
	$ssDen = (int)$uwxC['globalSessionSiteCount'];
	$scDen = (int)$uwxC['globalSubCenterCount'];
	$cardsList = $R['cards'];
	$scoreCardsList = $R['scoreCards'];

	/* Meta line */
	$stateName = $uwxC['stateName'];
	$distName = $uwxC['distName'];
	$dqaLbl = []; foreach($monthKeys as $mk){ $dqaLbl[] = uwx_month_year_label($mk); }
	$durationStr = uwx_period_duration_label($monthKeys).(count($dqaLbl) ? ' ('.(count($dqaLbl) === 1 ? $dqaLbl[0] : $dqaLbl[0].'–'.$dqaLbl[count($dqaLbl) - 1]).')' : '');
	$durationStrHtml = preg_replace('/\s*\(/', '<br>(', h($durationStr), 1);
	/* the declared From - To dates of the files behind the selected periods (uploadPeriod.ts declaredWindow) */
	$uwxPeriods = isset($_SESSION['uwx_periods']) ? (array)$_SESSION['uwx_periods'] : [];
	$uwxSelKeys = array_fill_keys($selMonthKeysOrdered, true);
	$uwxFrom = ''; $uwxTo = ''; $uwxDur = isset($_SESSION['uwx_duration']) ? (string)$_SESSION['uwx_duration'] : '';
	foreach($uwxPeriods as $p){
		if(!isset($uwxSelKeys[$p['key']])) continue;
		if($uwxFrom === '' || $p['from'] < $uwxFrom) $uwxFrom = $p['from'];
		if($uwxTo === '' || $p['to'] > $uwxTo) $uwxTo = $p['to'];
	}
	$uwxDatesLabel = ($uwxFrom !== '') ? uwx_day_label($uwxFrom).' – '.uwx_day_label($uwxTo) : '';

	/* Tables for the panels (built by the engine) */
	$t0 = $R['t0Rows']; $t7 = $R['t7Rows']; $t9 = $R['t9Rows'];
	$t2 = $R['t2Flat'];
	$t2Title = 'Key Missing Indicators';
	$selVaxList = $R['cmpVax'];
	$t6_web = $R['t6Web']; $t8_web = $R['t8Web'];
	$pairList = $R['pairList'];
	$t5_p3gtp1 = $R['i1Rows']; $t5_mr2gtmr1 = $R['i2Rows'];

	$t6_export = [];
	$h1 = dqa_id_head(); $h2 = dqa_id_blank();
	foreach(array_merge($selMonthKeysOrdered, ['__ALL__']) as $mk){
		$h1[] = ($mk === '__ALL__') ? 'All months' : $selMonthLabelsOrdered[$mk]; $h1[] = ''; $h1[] = '';
		$h2[] = 'Sessions Planned'; $h2[] = 'Sessions Held'; $h2[] = '% not held';
	}
	$t6_export[] = $h1; $t6_export[] = $h2;
	foreach($t6_web['rows'] as $r6){
		$line = dqa_id_row($r6['block'], $r6['facility'], $r6['sessionsite']);
		foreach($selMonthKeysOrdered as $mk){
			$c6 = $r6['cells'][$mk];
			if($c6['hit']){ $line[] = round($c6['p']); $line[] = round($c6['h']); $line[] = round($c6['pct'], 1).'%'; } else { $line[] = ''; $line[] = ''; $line[] = ''; }
		}
		$tt = $r6['totals'];
		if($tt['hit']){ $line[] = round($tt['p']); $line[] = round($tt['h']); $line[] = round($tt['pct'], 1).'%'; } else { $line[] = ''; $line[] = ''; $line[] = ''; }
		$t6_export[] = $line;
	}
	$t8_export = [];
	$h1 = dqa_id_head(); $h2 = dqa_id_blank();
	foreach(array_merge($selMonthKeysOrdered, ['__ALL__']) as $mk){
		$h1[] = ($mk === '__ALL__') ? 'All months' : $selMonthLabelsOrdered[$mk]; $h1[] = ''; $h1[] = '';
		$h2[] = 'Session Held'; $h2[] = 'Beneficiaries'; $h2[] = 'Average';
	}
	$t8_export[] = $h1; $t8_export[] = $h2;
	foreach($t8_web['rows'] as $r8){
		$line = dqa_id_row($r8['block'], $r8['facility'], $r8['sessionsite']);
		foreach($selMonthKeysOrdered as $mk){
			$c8 = $r8['cells'][$mk];
			if(!empty($c8['flag'])){ $line[] = ($c8['held'] === null ? '' : round($c8['held'])); $line[] = ($c8['ben'] === null ? '' : round($c8['ben'])); $line[] = ($c8['avg'] === null ? '' : round($c8['avg'], 1)); }
			else { $line[] = ''; $line[] = ''; $line[] = ''; }
		}
		$tt = $r8['totals'];
		if(!empty($tt['flag'])){ $line[] = round((float)$tt['held']); $line[] = round((float)$tt['ben']); $line[] = ($tt['avg'] === null ? '' : round($tt['avg'], 1)); } else { $line[] = ''; $line[] = ''; $line[] = ''; }
		$t8_export[] = $line;
	}
	$t3_rows_map = $R['t3Rows'];
	$t3_export = [];
	$t3h = dqa_id_head();
	foreach($R['accVax'] as $vx){ foreach($pairList as $p){ $t3h[] = $vx.' '.$p['m1lbl']; $t3h[] = $vx.' '.$p['m2lbl']; $t3h[] = $vx.' % Change ('.$p['m1lbl'].'–'.$p['m2lbl'].')'; } }
	$t3_export[] = $t3h;
	foreach($t3_rows_map as $r3){
		$line = dqa_id_row($r3['block'], $r3['facility'], $r3['sessionsite']);
		foreach($R['accVax'] as $vx){
			foreach($pairList as $p){
				$c3 = isset($r3['cells'][$vx][$p['k']]) ? $r3['cells'][$vx][$p['k']] : null;
				if(!$c3 || empty($c3['hit'])){ $line[] = ''; $line[] = ''; $line[] = ''; continue; }
				$line[] = ($c3['a'] === null ? '' : round($c3['a'])); $line[] = ($c3['b'] === null ? '' : round($c3['b']));
				$line[] = !empty($c3['fromZero']) ? 'from 0' : (($c3['pct'] > 0 ? '+' : '').round($c3['pct'], 1).'%');
			}
		}
		$t3_export[] = $line;
	}
	$drop_pair_map = []; $drop_tables = []; $drop_exports = [];
	foreach($R['drops'] as $dk=>$d){
		$drop_pair_map[$dk] = ['label'=>$d['label'], 'from'=>$d['from'], 'to'=>$d['to']];
		$drop_tables[$dk] = $d['web'];
		$exp = []; $eh = dqa_id_head();
		foreach($selMonthKeysOrdered as $mk){ $eh[] = $selMonthLabelsOrdered[$mk].' '.$d['from']; $eh[] = $selMonthLabelsOrdered[$mk].' '.$d['to']; $eh[] = $selMonthLabelsOrdered[$mk].' % dropout'; }
		$eh[] = 'All months '.$d['from']; $eh[] = 'All months '.$d['to']; $eh[] = 'All months % dropout';
		$exp[] = $eh;
		foreach($d['web']['rows'] as $rd){
			$line = dqa_id_row($rd['block'], $rd['facility'], $rd['sessionsite']);
			foreach($selMonthKeysOrdered as $mk){ $cd = $rd['cells'][$mk]; $line[] = ($cd['from'] === null ? '' : round($cd['from'])); $line[] = ($cd['to'] === null ? '' : round($cd['to'])); $line[] = ($cd['pct'] === null ? '' : round($cd['pct'], 1).'%'); }
			$line[] = round($rd['all']['from']); $line[] = round($rd['all']['to']); $line[] = ($rd['all']['pct'] === null ? '' : round($rd['all']['pct'], 1).'%');
			$exp[] = $line;
		}
		$drop_exports[$dk] = $exp;
	}
	$_SESSION['drop_pair_map'] = $drop_pair_map;
	$incons_pair_map = []; $incons_tables = []; $incons_export_map = [];
	foreach($R['incons'] as $dl=>$m){
		$incons_pair_map[$dl] = ['from'=>$m['from'], 'to'=>$m['to'], 'label'=>$m['label'], 'pid'=>$m['pid']];
		$incons_tables[$m['pid']] = $m['rows'];
		$incons_export_map[$dl] = $m['rows'];
	}
	$_SESSION['incons_pair_map'] = $incons_pair_map;
	$coTables = []; $coExports = [];
	foreach($R['co'] as $ck=>$x){
		$coTables[$ck] = $x['web'];
		$vl = $x['web']['vaccines'];
		$exp = []; $eh = dqa_id_head();
		foreach($selMonthKeysOrdered as $mk){ foreach($vl as $vx){ $eh[] = $selMonthLabelsOrdered[$mk].' '.display_vax_label($vx); } }
		foreach($vl as $vx){ $eh[] = 'All months '.display_vax_label($vx); }
		$exp[] = $eh;
		foreach($x['web']['rows'] as $rc){
			$line = dqa_id_row($rc['block'], $rc['facility'], $rc['sessionsite']);
			foreach($selMonthKeysOrdered as $mk){ foreach($vl as $vx){ $v = $rc['vals'][$mk][$vx]; $line[] = ($v === null ? '' : round($v)); } }
			foreach($vl as $vx){ $line[] = ($rc['totals'][$vx] === null ? '' : round($rc['totals'][$vx])); }
			$exp[] = $line;
		}
		$coExports[$ck] = $exp;
	}

	/* Top-3 lists of the Key Missing Indicators and Outliers cards */
	$topN = function($counts){ arsort($counts); $o = []; foreach($counts as $vx=>$n){ if($n <= 0) continue; $o[] = display_vax_label($vx).' ('.$n.')'; if(count($o) === 3) break; } return $o; };
	$blankAnyOnly = []; foreach($R['blankCnt'] as $vx=>$n){ $blankAnyOnly[$vx] = max(0, $n - $R['blankAll'][$vx]); }
	$top3BlankAny = $topN($blankAnyOnly); $top3BlankAll = $topN($R['blankAll']); $top3BlankOverall = $topN($R['blankCnt']);
	$top3OutOverall = $topN($R['outAny']);

	/* Summary tables (Indicator / units / %), as the web application builds them */
	$summaryByPid = [];
	$summaryTotalDen = max(1, $selDen);
	$mkRow = function($name, $cnt) use ($summaryTotalDen){ $cnt = (int)$cnt; return ['name'=>$name, 'count'=>$cnt, 'pct'=>round($cnt / $summaryTotalDen * 100, 2)]; };
	$stOf = []; foreach($cardsList as $c){ $stOf[$c['id']] = $c['stat']; }
	$s1 = function($id, $name, $overall = false) use ($stOf, $mkRow){
		$s = isset($stOf[$id]) ? $stOf[$id] : ['total'=>0,'any'=>0,'all'=>0];
		$o = ['any'=>[$mkRow($name, $s['any'])], 'all'=>[$mkRow($name, $s['all'])]];
		if($overall) $o['overall'] = [$mkRow($name, $s['total'])];
		return $o;
	};
	$summaryByPid['t0'] = $s1('t0', 'Indicators having 0 values');
	$summaryByPid['t7'] = $s1('t7', 'Indicators with same values');
	$summaryByPid['t9'] = $s1('t9', 'Zero coverage session');
	$sortPct = function($rows){ usort($rows, function($a, $b){ return $b['pct'] <=> $a['pct']; }); return $rows; };
	$anyRows = []; $allRows = []; $ovRows = [];
	foreach($selVaxList as $vx){ $anyRows[] = $mkRow($vx, max(0, $R['blankCnt'][$vx] - $R['blankAll'][$vx])); $allRows[] = $mkRow($vx, $R['blankAll'][$vx]); $ovRows[] = $mkRow($vx, $R['blankCnt'][$vx]); }
	$summaryByPid['t2'] = ['any'=>$sortPct($anyRows), 'all'=>$sortPct($allRows), 'overall'=>$sortPct($ovRows)];
	$ovRows = []; foreach($R['accVax'] as $vx){ $ovRows[] = $mkRow($vx, $R['outAny'][$vx]); }
	$summaryByPid['t3'] = ['any'=>[], 'all'=>[], 'overall'=>$sortPct($ovRows)];
	$summaryByPid['t6'] = $s1('t6', 'Planned but not held', true);
	$summaryByPid['t8'] = $s1('t8', 'Avg Beneficiaries / Session < 5', true);
	foreach($drop_pair_map as $dk=>$pm){ $summaryByPid[$dk] = $s1($dk, $pm['label'], true); }
	$summaryByPid['i1'] = ['any'=>[$mkRow('Penta3>Penta1', isset($stOf['i1']) ? $stOf['i1']['total'] : 0)], 'all'=>[]];
	$summaryByPid['i2'] = ['any'=>[$mkRow('MR2>MR1', isset($stOf['i2']) ? $stOf['i2']['total'] : 0)], 'all'=>[]];

	/* Charts payload: units flagged per block */
	$groupColor = ['availability'=>'#0ea5e9', 'completeness'=>'#6366f1', 'accuracy'=>'#f97316', 'consistency'=>'#22c55e'];
	$inconsLight = '#86efac';
	$charts = [];
	foreach($cardsList as $c){
		$counts = [];
		foreach($c['stat']['keys'] as $k){ $b = uwx_display_block(isset($facFiltered[$k]) ? $facFiltered[$k]['block'] : ''); $counts[$b] = isset($counts[$b]) ? $counts[$b] + 1 : 1; }
		ksort($counts, SORT_NATURAL|SORT_FLAG_CASE);
		$col = ($c['group'] === 'consistency' && ($c['id'] === 'i1' || $c['id'] === 'i2' || str_starts_with($c['id'], 'iadd_'))) ? $inconsLight : $groupColor[$c['group']];
		$charts[$c['id']] = ['labels'=>array_keys($counts), 'values'=>array_values($counts), 'color'=>$col];
	}

	/* Export store */
	$_SESSION['dqa_hl'] = $R['HL']; /* cells for "Actual data with highlighted cells" */
	$_SESSION['dqa_render_id'] = dqa_new_upload_id(); /* this page's id: its highlighted-download links carry it */
	$_SESSION['exports'] = [];
	$_SESSION['exports']['t0'] = ['label'=>'Indicators_0_not_blank_matrix','rows'=>$t0];
	$_SESSION['exports']['t7'] = ['label'=>'Indicators_with_same_values','rows'=>$t7];
	$_SESSION['exports']['t9'] = ['label'=>'Zero_coverage_session','rows'=>$t9];
	$_SESSION['exports']['t2'] = ['label'=>'Missing_Indicator_matrix','rows'=>$t2];
	$_SESSION['exports']['t6'] = ['label'=>'Planned_but_not_held','rows'=>$t6_export];
	$_SESSION['exports']['t8'] = ['label'=>'Avg_Beneficiaries_per_session_lt_5','rows'=>$t8_export];
	$_SESSION['exports']['t3'] = ['label'=>'Outliers_matrix','rows'=>$t3_export];
	$_SESSION['exports']['t5_p3gtp1'] = ['label'=>'Inconsistencies_Penta3_gt_Penta1','rows'=>$t5_p3gtp1];
	$_SESSION['exports']['t5_mr2gtmr1'] = ['label'=>'Inconsistencies_MR2_gt_MR1','rows'=>$t5_mr2gtmr1];
	foreach($incons_export_map as $dlKey=>$rowsExp){ $_SESSION['exports'][$dlKey] = ['label'=>$dlKey,'rows'=>$rowsExp]; }
	foreach($coExports as $ck=>$rowsExp){ $_SESSION['exports'][$ck] = ['label'=>strtoupper($ck).'_CoAdmin_matrix','rows'=>$rowsExp]; }
	foreach($drop_exports as $dk=>$rowsExp){ $_SESSION['exports'][$dk] = ['label'=>'Dropouts_'.$drop_pair_map[$dk]['from'].'_to_'.$drop_pair_map[$dk]['to'],'rows'=>$rowsExp]; }
	/* units of every card, for the full-file export */
	$_SESSION['pink_fac_sets'] = [];
	foreach($cardsList as $c){ $_SESSION['pink_fac_sets'][$c['downloadKey']] = $c['stat']['keys']; }

	$initGroup = $filters['active_group'];

	/* Y/N legend texts (Y = no issue, N = issue) under each Y/N matrix, and the rule notes */
	$dqaYnNotes = [
		't0' => "N marks a period in which every vaccine-dose column is reported and is 0 (a blank is not 0). A period already counted as a zero coverage session shows –.",
		't7' => "N marks a period in which every column after Month is reported, is not 0 and carries the same value.",
		't2' => "N marks a key indicator left blank for that period.",
		't9' => "N marks a period with a session held and no beneficiary vaccinated (beneficiary and Td counts reported and adding up to 0).",
	];
	$dqaInconsNote = "Totals add the selected periods in which both doses are reported. Flagged when the later dose is higher by more than 25% (50% when both totals are under 10; from 0, when it reaches 10).";
	$dqaCoNote = "A period is counted when a reported value of the group is more than 25% away from the group's reference value (50% when the reference is under 10): the value repeated most often, otherwise Penta, otherwise MR, otherwise the median. Blank cells are not compared. Red = out of range. \"All months\" totals = periods where every reported vaccine is present, for reference only.";
	$dqaPanelNotes = [
		't6' => "A period is counted when Sessions Planned is more than 0, Sessions Held is reported and Held is less than Planned. All-months totals use the periods where both are reported, for reference only.",
		't8' => "A period is counted when Sessions Held is more than 0 and the beneficiaries per session held are fewer than 5 (a zero coverage session is counted there instead). All-months totals are for reference only.",
		't3' => "Consecutive periods only; a period with every vaccine dose 0 is not compared. Both values under 10: increases need twice the %, decreases are not flagged; a rise from 0 to 10 or more is extreme.",
		'i1' => $dqaInconsNote, 'i2' => $dqaInconsNote,
		'co1' => $dqaCoNote, 'co2' => $dqaCoNote, 'co3' => $dqaCoNote, 'co4' => $dqaCoNote, 'co5' => $dqaCoNote,
	];
	foreach($drop_pair_map as $dk=>$pm){ $dqaPanelNotes[$dk] = "Dropout over all selected periods in which both doses are reported (first dose above 0)."; }
	foreach($incons_pair_map as $dqa_dk=>$dqa_meta){ $dqaPanelNotes[$dqa_meta['pid']] = $dqaInconsNote; }
	$t2_web = [
		'title' => $t2Title,
		'vaccines' => $selVaxList,
		'months' => $selMonthKeysOrdered,
		'monthLabels' => $selMonthLabelsOrdered,
		'rows' => $R['t2Matrix'],
		'highlightN' => true,
		'ynNote' => $dqaYnNotes['t2']
	];
	$t3_web = ['vaccines'=>$R['accVax'], 'pairs'=>$pairList, 'rows'=>$t3_rows_map, 'highlightN'=>false];

	/* Build panels HTML blocks */
	$panelBlocks = ['main'=>[], 'cons_incons'=>[], 'cons_missed'=>[]];

	foreach($cardsList as $c){
		$pid = $c['id'];
		$grp = $c['group'];
		$dlKey = $c['downloadKey'];
		$totalVal = (int)$c['stat']['total'];

		/* CHANGED: If KPI has 0 values, do not show its related chart/table panel */
		$panelZeroStyle = ($totalVal<=0) ? " style='display:none'" : "";

		ob_start();
		?>
		<div class="panel" data-group="<?=h($grp)?>" data-total="<?=$totalVal?>" data-dlkey="<?=h($dlKey)?>" id="panel-<?=h($pid)?>"<?=$panelZeroStyle?>>
			<div class="panelHeader">
				<div><div class="panelTitle"><?=h(display_text_with_fipv($c['name']))?></div></div>
				<div class="panelControls">
					<div class="toggleGroup">
					<button type="button" class="toggleBtn active" data-target="<?=h($pid)?>" data-view="chart">Chart</button>
					<button type="button" class="toggleBtn" data-target="<?=h($pid)?>" data-view="table">Table</button>
					<?php if($grp==='completeness' || $grp==='accuracy'): ?>
						<button type="button" class="toggleBtn" data-target="<?=h($pid)?>" data-view="summary">Summary</button>
					<?php endif; ?>
					
					</div>
					<a class="btn" href="<?=h($BASE_URL)?>?<?=h(isset($ACCESS_QS) ? $ACCESS_QS : '')?>&download_pink=<?=h($dlKey)?>&dqa_uid=<?=h(isset($_SESSION['dqa_upload_id']) ? (string)$_SESSION['dqa_upload_id'] : '')?>&dqa_rid=<?=h(isset($_SESSION['dqa_render_id']) ? (string)$_SESSION['dqa_render_id'] : '')?>">Actual data with highlighted cells</a>
				</div>
				<button type="button" class="dlIcon" data-target="<?=h($pid)?>" title="Download">⬇</button>
			</div>
			<div class="viewport">
				<div class="chartBox" id="chartBox-<?=h($pid)?>">
					<div class="chartStage"><canvas id="canvas-<?=h($pid)?>"></canvas></div>
				</div>
				<div class="tableBox" id="tableBox-<?=h($pid)?>">
					<div class="tableStage">
						<?php
						if($pid==='t0'){
							render_table($t0, true, $dqaYnNotes['t0']);
						} elseif($pid==='t7'){
							render_table($t7, true, $dqaYnNotes['t7']);
						} elseif($pid==='t9'){
							render_table($t9, true, $dqaYnNotes['t9']);
						} elseif($pid==='t2'){
							render_missing_indicator_two_level($t2_web);
						} elseif($pid==='t6'){
							render_planned_not_held_two_level($t6_web);
						} elseif($pid==='t8'){
							render_beneficiaries_avg_two_level($t8_web);
						} elseif($pid==='t3'){
							render_outliers_two_level($t3_web);
						} elseif(str_starts_with($pid,'drop_')){
							if(isset($drop_tables[$pid])) render_dropouts_pair_two_level($drop_tables[$pid]);
							else echo "<div style='padding:12px'>No records.</div>";
						} elseif($pid==='i1'){
							render_table($t5_p3gtp1, false);
						} elseif($pid==='i2'){
							render_table($t5_mr2gtmr1, false);
						} elseif(str_starts_with($pid,'iadd_')){
							if(isset($incons_tables[$pid])) render_table($incons_tables[$pid], false);
							else echo "<div style='padding:12px'>No records.</div>";
						} elseif(str_starts_with($pid,'co')){
							if(isset($coTables[$pid])) render_coadmin_two_level($coTables[$pid]);
							else echo "<div style='padding:12px'>No records.</div>";
						} else {
							echo "<div style='padding:12px'>No records.</div>";
						}
						?>
					</div>
					<?php if($grp==='completeness' || $grp==='accuracy'): ?>
					<div class="summaryBoxKpi summaryScroll" style="display:none">
						<?php
						$sum = isset($summaryByPid[$pid]) ? $summaryByPid[$pid] : ['any'=>[],'all'=>[],'overall'=>[]];
						$renderSum = function($rows){
							echo '<table class="dataTable"><thead><tr><th>Indicator</th><th>'.h($unitTitle).'</th><th>%</th></tr></thead><tbody>';
							foreach($rows as $r){
								echo '<tr><td>'.h(display_text_with_fipv($r['name'])).'</td><td>'.h((string)$r['count']).'</td><td>'.h((string)$r['pct']).'%</td></tr>';
							}
							echo '</tbody></table>';
						};
						if(!empty($sum['any'])){
							echo '<div class="small" style="margin:6px 0 4px"><b>Any month</b></div>';
							$renderSum($sum['any']);
						}
						if(!empty($sum['all'])){
						echo '<div class="small" style="margin:12px 0 4px"><b>All months</b></div>';
						$renderSum($sum['all']);
					}
					if(!empty($sum['overall'])){
						echo '<div class="small" style="margin:12px 0 4px"><b>Overall</b></div>';
						$renderSum($sum['overall']);
					}
					?>
					</div>
					<?php endif; ?>
				</div>
			</div>
			<?php if(isset($dqaYnNotes[$pid])): ?><div class="ynNoteBox"><?=dqa_yn_note($dqaYnNotes[$pid])?></div><?php endif; ?>
			<?php if(isset($dqaPanelNotes[$pid])): ?><div class="ynNoteBox"><div class="ynNote"><?=h($dqaPanelNotes[$pid])?></div></div><?php endif; ?>
		</div>
		<?php
		$panelHtml = ob_get_clean();

		if($grp !== 'consistency'){
			$panelBlocks['main'][] = $panelHtml;
		} else {
			/* Put all inconsistencies (including dynamic) into the “Inaccurate Indicators” group */
			if($pid === 'i1' || $pid === 'i2' || str_starts_with($pid,'iadd_')){
				$panelBlocks['cons_incons'][] = $panelHtml;
			} else {
				$panelBlocks['cons_missed'][] = $panelHtml;
			}
		}
	}

	/* KPI cards HTML */
	$kpiCardsHtml = '';
	$kpiCardsHtmlConsIncons = '';
	$kpiCardsHtmlConsMissed = '';
	foreach($cardsList as $c){
		$pid = $c['id'];
		$grp = $c['group'];
		$totalVal = (int)$c['stat']['total'];

		/* Kind class for Consistency KPI cards */
		$kind = '';
		if($grp === 'consistency'){
			if($pid === 'i1' || $pid === 'i2' || str_starts_with($pid,'iadd_')) $kind = ' kind-incons';
			else $kind = ' kind-missed';
		}

		$cls = "kpi kpiCard group-".$grp.$kind;
		$cardHtml = '<div class="'.h($cls).'" data-group="'.h($grp).'" data-target="'.h($pid).'" data-total="'.h((string)$totalVal).'">';
		$cardHtml .= '<h3>'.h(display_text_with_fipv($c['name'])).'</h3>';
		$showSplit = (isset($c['stat']['any']) && isset($c['stat']['all']) && (
			$grp==='availability' || $pid==='t2' || $pid==='t6' || $pid==='typ' || $pid==='t8' || str_starts_with($pid,'drop_') || str_starts_with($pid,'co')
		));

		if($showSplit){
			$anyCnt = (int)$c['stat']['any'];
			$allCnt = (int)$c['stat']['all'];
			$cardHtml .= '<div class="splitTotal"><span class="splitTotalNum">'.h((string)$totalVal).'</span><span class="unit"> '.h($unitPlural).'</span></div>';
			$cardHtml .= '<div class="split"><div class="splitCol"><div class="splitLbl">Any month</div><div class="splitVal"><span class="splitValNum">'.h((string)$anyCnt).'</span><span class="unit"> '.h($unitPlural).'</span></div></div><div class="splitCol"><div class="splitLbl">All months</div><div class="splitVal"><span class="splitValNum">'.h((string)$allCnt).'</span><span class="unit"> '.h($unitPlural).'</span></div></div></div>';

			// add top-3 lists for Completeness and Outliers (kept as-is)
			if($pid==='t2'){
				$cardHtml .= '<div class="top3"><div class="top3Row"><b>Any month:</b> '.h(implode(', ', $top3BlankAny)).'</div><div class="top3Row"><b>All months:</b> '.h(implode(', ', $top3BlankAll)).'</div><div class="top3Row"><b>Overall:</b> '.h(implode(', ', $top3BlankOverall)).'</div></div>';
			}
			if($pid==='t3'){
				$cardHtml .= '<div class="top3"><div class="top3Row">'.h(!empty($top3OutOverall)?implode(', ', $top3OutOverall):'-').'</div></div>';
			}
		} else {
			// Single-number KPI card (no "facilities" text)
			$cardHtml .= '<div class="num">'.h((string)$totalVal).' <span class="unit">'.h($unitPlural).'</span></div>';
			if($pid==='t3'){
				$cardHtml .= '<div class="top3"><div class="top3Row">'.h(!empty($top3OutOverall)?implode(', ', $top3OutOverall):'-').'</div></div>';
			}

		}

		$cardHtml .= '</div>';

		if($grp !== 'consistency'){
			$kpiCardsHtml .= $cardHtml;
		} else {
			if($kind === ' kind-incons') $kpiCardsHtmlConsIncons .= $cardHtml;
			else $kpiCardsHtmlConsMissed .= $cardHtml;
		}
	}

	$chartsJson = json_encode($charts, JSON_UNESCAPED_UNICODE);

	$justUploadedFlag = $justUploaded ? '1' : '0';
	$hasAppliedFlag = $hasApplied ? '1' : '0';
	$showOutliersFlag = $showOutliersDropdown ? '1' : '0';
	$showDropoutsFlag = $showDropoutsDropdown ? '1' : '0';

	$dropFromSel = isset($filters['drop_from']) ? (array)$filters['drop_from'] : [];
	$dropToSel = isset($filters['drop_to']) ? (array)$filters['drop_to'] : [];

	/* pair rows index-wise */
	$pairRowCount = max(count($dropFromSel), count($dropToSel));
	if($pairRowCount < 1) $pairRowCount = 1;

	/* NEW: inconsistencies pair rows index-wise */
	$inconsFromSel = isset($filters['incons_from']) ? (array)$filters['incons_from'] : [];
	$inconsToSel = isset($filters['incons_to']) ? (array)$filters['incons_to'] : [];
	$inconsPairRowCount = max(count($inconsFromSel), count($inconsToSel));
	if($inconsPairRowCount < 1) $inconsPairRowCount = 1;

	/* -------------------- Overall Score data --------------------
	   (changed 2026-11, web parity) scoring method v8 of the DQA web application, U-WIN weights
	   (uwx_weight_table): Availability 33.3 (t0, t7, t9); Accuracy 33.3 (1 period: Planned but not
	   held and Avg beneficiaries per session < 5; 2 or more periods: those, Outliers and the 3
	   standard dropouts); Consistency 33.3 (Penta3>Penta1 and MR2>MR1; the 5 co-administration
	   groups). Completeness is not scored for U-WIN. Check score = 100 - % of the units under the
	   selection it flags; the weight of a check that cannot run passes to the other checks of its
	   group, then its component, then the other components. The score always uses the standard
	   checks (standard outlier vaccines and bands, the 3 dropout pairs at 20% or more, no custom
	   pairs), whatever is ticked, so the same data always gets the same score. */
	$osDen = $selDen; /* units under the current selection, at the level on screen */
	$scorePeriodCount = count($selMonthKeysOrdered);
	$wScore = uwx_score_of($R);
	$osComponents = [
		'availability'=>['name'=>'Availability','kpis'=>[]],
		'accuracy'=>['name'=>'Accuracy','kpis'=>[]],
		'consistency'=>['name'=>'Consistency','kpis'=>[]],
	];
	foreach($scoreCardsList as $c){
		$g = $c['group'];
		if(!isset($osComponents[$g])) continue;
		$stat = $c['stat'];
		if($osDen <= 0 || (int)$stat['eligible'] <= 0) continue; /* a check that could not be run is not listed */
		$tot = (int)$stat['total']; $any = (int)$stat['any']; $all = (int)$stat['all'];
		$osComponents[$g]['kpis'][] = ['name'=>display_text_with_fipv($c['name']), 'total'=>$tot, 'any'=>$any, 'all'=>$all,
			'pct'=>$tot * 100.0 / $osDen, 'pctAny'=>$any * 100.0 / $osDen, 'pctAll'=>$all * 100.0 / $osDen];
	}
	$osMini = []; $osScores = [];
	foreach($osComponents as $gid=>$g){
		$kpis = $g['kpis'];
		usort($kpis, function($a, $b){ return $b['pct'] <=> $a['pct']; });
		$top = ($gid === 'consistency') ? array_slice($kpis, 0, 7) : array_slice($kpis, 0, 5);
		$maxAny = 0.0; $maxAll = 0.0; $maxTot = 0.0;
		foreach($kpis as $r){ if($r['pctAny'] > $maxAny) $maxAny = $r['pctAny']; if($r['pctAll'] > $maxAll) $maxAll = $r['pctAll']; if($r['pct'] > $maxTot) $maxTot = $r['pct']; }
		$score = isset($wScore['components'][$gid]) ? $wScore['components'][$gid] : null; /* null = N/A */
		$osScores[$gid] = $score;
		$osComponents[$gid]['top'] = $top;
		$osComponents[$gid]['maxAny'] = $maxAny;
		$osComponents[$gid]['maxAll'] = $maxAll;
		$osComponents[$gid]['score'] = $score;
		$osComponents[$gid]['weight'] = isset($wScore['componentWeights'][$gid]) ? $wScore['componentWeights'][$gid] : 0;
		$osMini[] = ['id'=>$gid, 'name'=>$g['name'], 'score'=>$score, 'maxTot'=>$maxTot];
	}
	$overallScore = $wScore['overall']; /* null = nothing could be scored */

	/* the score recorded in the database is always the Sub Center-wise one (Facility-wise when the
	   file has no Sub Center column), as the web application saves every review, whatever level
	   is on screen; same scope, standard checks */
	if($uwxMode === $stdMode){
		$recScores = $osScores; $recOverall = $overallScore; $recCards = $scoreCardsList; $recDen = $osDen;
	} else {
		$R2 = uwx_compute_with_score($uwxC, array_merge($uwxF, ['analysisMode'=>$stdMode]));
		$w2 = uwx_score_of($R2);
		$recScores = $w2['components']; $recOverall = $w2['overall']; $recCards = $R2['scoreCards']; $recDen = (int)$R2['den'];
		unset($R2);
	}

	/* ==================================================================
	   (added) DQA KPI score recording (dqa_score_run / dqa_score_kpi)
	   ------------------------------------------------------------------
	   Purpose: performance monitoring over time. Every time the user
	   presses "Apply Filter" with every selection at its default (the
	   whole upload: all blocks, all months and every analysis option at
	   its default), the KPI percentages of all 4 components shown on
	   screen are saved to MySQL together with tool, State, District,
	   Block, period of the uploaded data, date of use, designation and
	   purpose. Repeated presses in the same session update the same row
	   (upsert on run_key), so exactly one benchmark row exists per
	   launch + upload. Runs where any filter was narrowed are NOT
	   recorded, because their percentages are not comparable across
	   periods (the denominator always covers the whole upload).
	   Best-effort: any DB problem is silent and never affects the user.
	   ================================================================== */
	if ($hasApplied && !empty($monthKeys) && $osDen > 0) {
		$dqa_sc_same = function($sel, $all){
			$s = array_map('strval', array_values((array)$sel));
			$a = array_map('strval', array_values((array)$all));
			$s = array_values(array_unique($s)); $a = array_values(array_unique($a));
			sort($s, SORT_STRING); sort($a, SORT_STRING);
			return $s === $a;
		};
		/* (changed 2026-11) scope only (all blocks, all periods): the score always uses the standard checks */
		$dqa_sc_unfiltered = empty($bSel) && (empty($mSel) || $dqa_sc_same($mSel, $monthKeys));
		if ($dqa_sc_unfiltered) {
			/* Same database as dqa.php (where dqa_usage_log lives). */
			$DQA_SC_DB_HOST = 'localhost';
			$DQA_SC_DB_NAME = 'epsvdwgx_reviewdatabase';
			$DQA_SC_DB_USER = 'epsvdwgx_mainadmin';
			$DQA_SC_DB_PASS = 'Ramkrishna$1210';
			try {
				/* Period of the uploaded data (ALL uploaded months). */
				/* (changed 2026-11) the calendar months the periods cover (a week maps to its month) */
				$dqa_sc_mkeys = array(); foreach($monthKeys as $dqa_sc_pk){ foreach(uwx_period_months($dqa_sc_pk) as $dqa_sc_pm){ $dqa_sc_mkeys[$dqa_sc_pm] = true; } }
				$dqa_sc_mkeys = array_keys($dqa_sc_mkeys);
				sort($dqa_sc_mkeys, SORT_STRING);
				$dqa_sc_mcount = count($dqa_sc_mkeys);
				$dqa_sc_min = $dqa_sc_mkeys[0];
				$dqa_sc_max = $dqa_sc_mkeys[$dqa_sc_mcount - 1];
				$dqa_sc_span = months_span_inclusive($dqa_sc_min, $dqa_sc_max);
				$dqa_sc_contig = ($dqa_sc_span !== null && (int)$dqa_sc_span === $dqa_sc_mcount) ? 1 : 0;
				if ($uwxDur === 'WEEKLY' && $uwxDatesLabel !== '') {
					$dqa_sc_period = $uwxDatesLabel; /* (added 2026-11) weekly files: the declared dates */
				} elseif ($dqa_sc_mcount === 1) {
					$dqa_sc_period = month_label_from_key_my($dqa_sc_min);
				} elseif ($dqa_sc_contig === 1) {
					$dqa_sc_period = month_label_from_key_my($dqa_sc_min) . ' to ' . month_label_from_key_my($dqa_sc_max);
				} else {
					$dqa_sc_lbls = array();
					foreach ($dqa_sc_mkeys as $dqa_sc_mk) { $dqa_sc_lbls[] = month_label_from_key_my($dqa_sc_mk); }
					$dqa_sc_period = implode(', ', $dqa_sc_lbls);
				}
				/* State / District: from the uploaded file. 'Multiple' means the file
				   mixed more than one distinct value (often just spelling/case variants
				   of the same place), so it is never recorded: the launcher-verified
				   State and the District selected on the launcher form are used instead. */
				$dqa_sc_launch_state = (isset($_SESSION['dqa_launch']['state']) && $_SESSION['dqa_launch']['state'] !== '' && $_SESSION['dqa_launch']['state'] !== null)
					? (string)$_SESSION['dqa_launch']['state']
					: (isset($_SESSION['dqa_log_state']) ? (string)$_SESSION['dqa_log_state'] : null);
				$dqa_sc_launch_dist = (isset($_SESSION['dqa_launch']['district']) && $_SESSION['dqa_launch']['district'] !== '' && $_SESSION['dqa_launch']['district'] !== null)
					? (string)$_SESSION['dqa_launch']['district']
					: null;
				/* State from the uploaded data: when the file mixes more than one raw
				   value (tool shows 'Multiple'), the State of the FIRST data row that
				   carries one - trimmed - is used, so 'Multiple' is never written to the
				   state field. The launcher-verified State remains the last fallback
				   (file without any State column). */
				$dqa_sc_state_first = '';
				if (isset($idxState) && $idxState !== null && isset($rows) && is_array($rows)) {
					foreach ($rows as $dqa_sc_fr) {
						$dqa_sc_fv = trim((string)(isset($dqa_sc_fr[$idxState]) ? $dqa_sc_fr[$idxState] : ''));
						if ($dqa_sc_fv !== '') { $dqa_sc_state_first = $dqa_sc_fv; break; }
					}
				}
				/* File-derived State/District values are recorded in proper case
				   (e.g. "UTTAR PRADESH" -> "Uttar Pradesh"); launcher-form values are
				   kept verbatim - they are already properly formatted dropdown names. */
				$dqa_sc_proper = function($v){ return ucwords(strtolower(trim((string)$v)), " -.("); };
				$dqa_sc_state = ($stateName !== '' && $stateName !== '—' && $stateName !== 'Multiple')
					? $dqa_sc_proper($stateName)
					: ($dqa_sc_state_first !== '' ? $dqa_sc_proper($dqa_sc_state_first) : $dqa_sc_launch_state);
				$dqa_sc_district = ($distName !== '' && $distName !== '—' && $distName !== 'Multiple') ? $dqa_sc_proper($distName) : $dqa_sc_launch_dist;
				$dqa_sc_block = null;
				$dqa_sc_logid = !empty($_SESSION['dqa_log_id']) ? (int)$_SESSION['dqa_log_id'] : null;
				$dqa_sc_designation = null;
				$dqa_sc_purpose = null;
				try { $dqa_sc_now = new DateTime('now', new DateTimeZone('Asia/Kolkata')); }
				catch (Exception $dqa_sc_e) { $dqa_sc_now = new DateTime('now'); }
				$dqa_sc_used_on = $dqa_sc_now->format('Y-m-d H:i:s');
				$dqa_sc_date = $dqa_sc_now->format('d/m/Y');
				$dqa_sc_pdo = new PDO(
					'mysql:host=' . $DQA_SC_DB_HOST . ';dbname=' . $DQA_SC_DB_NAME . ';charset=utf8mb4',
					$DQA_SC_DB_USER, $DQA_SC_DB_PASS,
					array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 3)
				);
				/* Designation / Purpose: from the launch details carried in the session
				   (proper-use flow), or - legacy flow - from this launch's dqa_usage_log
				   record. */
				if (isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch'])) {
					$dqa_sc_lu = $_SESSION['dqa_launch'];
					$dqa_sc_designation = isset($dqa_sc_lu['designation']) ? $dqa_sc_lu['designation'] : null;
					$dqa_sc_purpose = isset($dqa_sc_lu['purpose']) ? $dqa_sc_lu['purpose'] : null;
					/* Block column intentionally left blank: this is a district-level tool. */
					$dqa_sc_logid = !empty($_SESSION['dqa_launch_logid']) ? (int)$_SESSION['dqa_launch_logid'] : null;
				} elseif ($dqa_sc_logid) {
					$dqa_sc_st = $dqa_sc_pdo->prepare('SELECT designation, purpose, block FROM dqa_usage_log WHERE id = :id LIMIT 1');
					$dqa_sc_st->execute(array(':id' => $dqa_sc_logid));
					$dqa_sc_row = $dqa_sc_st->fetch(PDO::FETCH_ASSOC);
					if ($dqa_sc_row) {
						$dqa_sc_designation = $dqa_sc_row['designation'];
						$dqa_sc_purpose = $dqa_sc_row['purpose'];
						/* Block column intentionally left blank: this is a district-level tool. */
					}
				}
				/* Auto-create the score tables on first use (keeps this a single, self-contained file). */
				$dqa_sc_pdo->exec('CREATE TABLE IF NOT EXISTS dqa_score_run (
					id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
					run_key CHAR(40) NOT NULL,
					usage_log_id BIGINT UNSIGNED DEFAULT NULL,
					tool_name VARCHAR(32) NOT NULL,
					state VARCHAR(100) DEFAULT NULL,
					district VARCHAR(100) DEFAULT NULL,
					block VARCHAR(100) DEFAULT NULL,
					period_label VARCHAR(120) DEFAULT NULL,
					period_start DATE DEFAULT NULL,
					period_end DATE DEFAULT NULL,
					months_count TINYINT UNSIGNED DEFAULT NULL,
					months_contiguous TINYINT(1) DEFAULT 1,
					date_of_use VARCHAR(10) DEFAULT NULL,
					used_on DATETIME DEFAULT NULL,
					designation VARCHAR(150) DEFAULT NULL,
					purpose VARCHAR(150) DEFAULT NULL,
					denominator INT UNSIGNED DEFAULT NULL,
					score_availability DECIMAL(6,2) DEFAULT NULL,
					score_completeness DECIMAL(6,2) DEFAULT NULL,
					score_accuracy DECIMAL(6,2) DEFAULT NULL,
					score_consistency DECIMAL(6,2) DEFAULT NULL,
					score_overall DECIMAL(6,2) DEFAULT NULL,
					PRIMARY KEY (id),
					UNIQUE KEY uq_run_key (run_key),
					KEY idx_compare (tool_name, state, district, block, months_count, period_start)
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
				$dqa_sc_pdo->exec('CREATE TABLE IF NOT EXISTS dqa_score_kpi (
					id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
					run_id BIGINT UNSIGNED NOT NULL,
					component VARCHAR(20) NOT NULL,
					kpi_code VARCHAR(60) NOT NULL,
					kpi_label VARCHAR(255) DEFAULT NULL,
					numerator INT UNSIGNED DEFAULT NULL,
					num_any INT UNSIGNED DEFAULT NULL,
					num_all INT UNSIGNED DEFAULT NULL,
					denominator INT UNSIGNED DEFAULT NULL,
					pct DECIMAL(6,2) DEFAULT NULL,
					pct_any DECIMAL(6,2) DEFAULT NULL,
					pct_all DECIMAL(6,2) DEFAULT NULL,
					PRIMARY KEY (id),
					UNIQUE KEY uq_run_kpi (run_id, kpi_code),
					KEY idx_run (run_id)
				) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
				/* Stable per-session key: in the proper-use flow the usage-log id does
				   not exist before the first recording, so it must not be part of the
				   key (0 is used); the legacy flow keeps the launch row id as before. */
				$dqa_sc_keyid = (isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch'])) ? 0 : (int)$dqa_sc_logid;
				$dqa_sc_key = sha1('dqauwin|' . session_id() . '|' . (int)$dqa_sc_keyid . '|' . (string)$dqa_sc_state . '|' . (string)$dqa_sc_district . '|' . $dqa_sc_period);
				/* record only the FIRST Apply Filter of this session for this district+period; later presses leave the recorded score untouched */
				$dqa_sc_chk = $dqa_sc_pdo->prepare('SELECT id FROM dqa_score_run WHERE run_key = :rk LIMIT 1');
				$dqa_sc_chk->execute(array(':rk' => $dqa_sc_key));
				if ($dqa_sc_chk->fetchColumn() === false) {
				/* Proper-use usage logging: the launch is written to dqa_usage_log only
				   now - at the FIRST unfiltered Apply Filter - so a usage row exists only
				   when the tool actually produced output. One row per session/launch;
				   a further recording in this session (e.g. a second period uploaded)
				   re-uses the same row instead of inserting another. */
				if (isset($_SESSION['dqa_launch']) && is_array($_SESSION['dqa_launch'])) {
					if (!empty($_SESSION['dqa_launch_logid'])) {
						$dqa_sc_logid = (int)$_SESSION['dqa_launch_logid'];
					} else {
						$dqa_sc_lu2 = $_SESSION['dqa_launch'];
						/* District for the usage row: the analysed file's District (title-cased)
						   when the file carried one clean value; otherwise the District selected
						   on the launcher form, stored verbatim. */
						$dqa_sc_lu2_district = ($distName !== '' && $distName !== '—' && $distName !== 'Multiple' && $dqa_sc_district !== null && $dqa_sc_district !== '')
							? substr(ucwords(strtolower($dqa_sc_district), " -.("), 0, 100)
							: (isset($dqa_sc_lu2['district']) ? $dqa_sc_lu2['district'] : null);
						$dqa_sc_lu2_st = $dqa_sc_pdo->prepare('INSERT INTO dqa_usage_log
							(workflow, workflow_url, ip_address, latitude, longitude, state, district,
							 block, tehsil, village, pin, country, organization, isp, designation, department, purpose,
							 date_of_use, time_of_use, created_at)
							VALUES
							(:workflow, :workflow_url, :ip_address, :latitude, :longitude, :state, :district,
							 :block, :tehsil, :village, :pin, :country, :organization, :isp, :designation, :department, :purpose,
							 :date_of_use, :time_of_use, :created_at)');
						$dqa_sc_lu2_st->execute(array(
							':workflow'     => isset($dqa_sc_lu2['workflow']) ? $dqa_sc_lu2['workflow'] : null,
							':workflow_url' => isset($dqa_sc_lu2['workflow_url']) ? $dqa_sc_lu2['workflow_url'] : null,
							':ip_address'   => isset($dqa_sc_lu2['ip_address']) ? $dqa_sc_lu2['ip_address'] : null,
							':latitude'     => isset($dqa_sc_lu2['latitude']) ? $dqa_sc_lu2['latitude'] : null,
							':longitude'    => isset($dqa_sc_lu2['longitude']) ? $dqa_sc_lu2['longitude'] : null,
							':state'        => isset($dqa_sc_lu2['state']) ? $dqa_sc_lu2['state'] : null,
							':district'     => $dqa_sc_lu2_district,
							':block'        => isset($dqa_sc_lu2['block']) ? $dqa_sc_lu2['block'] : null,
							':tehsil'       => isset($dqa_sc_lu2['tehsil']) ? $dqa_sc_lu2['tehsil'] : null,
							':village'      => isset($dqa_sc_lu2['village']) ? $dqa_sc_lu2['village'] : null,
							':pin'          => isset($dqa_sc_lu2['pin']) ? $dqa_sc_lu2['pin'] : null,
							':country'      => isset($dqa_sc_lu2['country']) ? $dqa_sc_lu2['country'] : null,
							':organization' => isset($dqa_sc_lu2['organization']) ? $dqa_sc_lu2['organization'] : null,
							':isp'          => isset($dqa_sc_lu2['isp']) ? $dqa_sc_lu2['isp'] : null,
							':designation'  => isset($dqa_sc_lu2['designation']) ? $dqa_sc_lu2['designation'] : null,
							':department'   => null,
							':purpose'      => isset($dqa_sc_lu2['purpose']) ? $dqa_sc_lu2['purpose'] : null,
							':date_of_use'  => $dqa_sc_date,
							':time_of_use'  => $dqa_sc_now->format('h:i:s A'),
							':created_at'   => $dqa_sc_used_on,
						));
						$dqa_sc_logid = (int)$dqa_sc_pdo->lastInsertId();
						if ($dqa_sc_logid > 0) { $_SESSION['dqa_launch_logid'] = $dqa_sc_logid; }
					}
				}
				$dqa_sc_sql = 'INSERT INTO dqa_score_run
					(run_key, usage_log_id, tool_name, state, district, block, period_label, period_start, period_end, months_count, months_contiguous, date_of_use, used_on, designation, purpose, denominator, score_availability, score_completeness, score_accuracy, score_consistency, score_overall)
					VALUES (:run_key, :usage_log_id, :tool_name, :state, :district, :block, :period_label, :period_start, :period_end, :months_count, :months_contiguous, :date_of_use, :used_on, :designation, :purpose, :denominator, :s_av, :s_co, :s_ac, :s_cn, :s_ov)
					ON DUPLICATE KEY UPDATE
					id = LAST_INSERT_ID(id), usage_log_id = VALUES(usage_log_id), state = VALUES(state), district = VALUES(district), block = VALUES(block), period_label = VALUES(period_label), period_start = VALUES(period_start), period_end = VALUES(period_end), months_count = VALUES(months_count), months_contiguous = VALUES(months_contiguous), date_of_use = VALUES(date_of_use), used_on = VALUES(used_on), designation = VALUES(designation), purpose = VALUES(purpose), denominator = VALUES(denominator), score_availability = VALUES(score_availability), score_completeness = VALUES(score_completeness), score_accuracy = VALUES(score_accuracy), score_consistency = VALUES(score_consistency), score_overall = VALUES(score_overall)';
				$dqa_sc_st = $dqa_sc_pdo->prepare($dqa_sc_sql);
				$dqa_sc_st->execute(array(
					':run_key' => $dqa_sc_key,
					':usage_log_id' => $dqa_sc_logid,
					':tool_name' => 'dqauwin',
					':state' => ($dqa_sc_state !== null ? substr((string)$dqa_sc_state, 0, 100) : null),
					':district' => ($dqa_sc_district !== null ? substr((string)$dqa_sc_district, 0, 100) : null),
					':block' => ($dqa_sc_block !== null && $dqa_sc_block !== '' ? substr((string)$dqa_sc_block, 0, 100) : null),
					':period_label' => substr($dqa_sc_period, 0, 120),
					':period_start' => $dqa_sc_min . '-01',
					':period_end' => $dqa_sc_max . '-01',
					':months_count' => $dqa_sc_mcount,
					':months_contiguous' => $dqa_sc_contig,
					':date_of_use' => $dqa_sc_date,
					':used_on' => $dqa_sc_used_on,
					':designation' => $dqa_sc_designation,
					':purpose' => $dqa_sc_purpose,
					':denominator' => (int)$recDen, /* (changed 2026-11) Sub Center-wise score */
					':s_av' => isset($recScores['availability']) ? round((float)$recScores['availability'], 2) : null,
					':s_co' => null, /* Completeness is not scored for U-WIN */
					':s_ac' => isset($recScores['accuracy']) ? round((float)$recScores['accuracy'], 2) : null,
					':s_cn' => isset($recScores['consistency']) ? round((float)$recScores['consistency'], 2) : null,
					':s_ov' => ($recOverall === null ? null : round((float)$recOverall, 2)),
				));
				$dqa_sc_runid = (int)$dqa_sc_pdo->lastInsertId();
				if ($dqa_sc_runid > 0) {
					$dqa_sc_del = $dqa_sc_pdo->prepare('DELETE FROM dqa_score_kpi WHERE run_id = :rid');
					$dqa_sc_del->execute(array(':rid' => $dqa_sc_runid));
					$dqa_sc_ins = $dqa_sc_pdo->prepare('INSERT INTO dqa_score_kpi
						(run_id, component, kpi_code, kpi_label, numerator, num_any, num_all, denominator, pct, pct_any, pct_all)
						VALUES (:rid, :component, :kpi_code, :kpi_label, :numerator, :num_any, :num_all, :denominator, :pct, :pct_any, :pct_all)');
					foreach ($recCards as $dqa_sc_c) { /* (changed 2026-11) the checks the recorded score is computed from */
						$dqa_sc_stat = isset($dqa_sc_c['stat']) ? $dqa_sc_c['stat'] : array('total' => 0, 'any' => 0, 'all' => 0);
						$dqa_sc_tot = isset($dqa_sc_stat['total']) ? (int)$dqa_sc_stat['total'] : 0;
						$dqa_sc_any = isset($dqa_sc_stat['any']) ? (int)$dqa_sc_stat['any'] : $dqa_sc_tot;
						$dqa_sc_all = isset($dqa_sc_stat['all']) ? (int)$dqa_sc_stat['all'] : 0;
						$dqa_sc_den = (int)$recDen;
						$dqa_sc_ins->execute(array(
							':rid' => $dqa_sc_runid,
							':component' => substr((string)$dqa_sc_c['group'], 0, 20),
							':kpi_code' => substr((string)$dqa_sc_c['id'], 0, 60),
							':kpi_label' => substr((string)$dqa_sc_c['name'], 0, 255),
							':numerator' => $dqa_sc_tot,
							':num_any' => $dqa_sc_any,
							':num_all' => $dqa_sc_all,
							':denominator' => $dqa_sc_den,
							':pct' => ($dqa_sc_den > 0) ? round($dqa_sc_tot * 100.0 / $dqa_sc_den, 2) : null,
							':pct_any' => ($dqa_sc_den > 0) ? round($dqa_sc_any * 100.0 / $dqa_sc_den, 2) : null,
							':pct_all' => ($dqa_sc_den > 0) ? round($dqa_sc_all * 100.0 / $dqa_sc_den, 2) : null,
						));
					}
				}
				} /* end first-apply-only guard */
			} catch (Exception $dqa_sc_e) { /* never surface score-recording errors to the user */ }
		}
	}
	/* ============== end of added DQA KPI score recording ============== */

	$overallSummaryHtml = '';
	$overallSummaryHtml .= '<div id="osOverlay" aria-hidden="true">';
	$overallSummaryHtml .=   '<div class="osTopbar"><div class="osWrap"><div class="osTopbarInner">';
	$overallSummaryHtml .=     '<div><div class="osTitle">Overall Score</div><div class="osMeta">'.h($stateName).' · '.h($distName).' · '.h(strip_tags($durationStrHtml)).' · '.h($uwxModes[$uwxMode]).'</div></div>';
	$overallSummaryHtml .=     '<div class="osBack"><button type="button" class="btn" id="osBackBtn">Back</button></div>';
	$overallSummaryHtml .=   '</div></div></div>';

	$overallSummaryHtml .=   '<div class="osWrap">';
	$overallSummaryHtml .=     '<div class="osGrid3">';
	/* cards describe the current selection (same denominator as every %) */
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Coverage</div><div class="k">'.h((string)$selBlocksCount).'</div><div class="s">blocks</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">'.h($unitTitle).'</div><div class="k">'.h((string)$osDen).' <span class="sm">'.h($unitPlural).'</span></div><div class="m">'.h($uwxModes[$uwxMode]).' analysis</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Period</div><div class="k">'.h((string)count($selMonthKeysOrdered)).'</div><div class="s">'.h($uwxDur === 'WEEKLY' ? 'weeks analysed' : 'months analysed').($uwxDatesLabel !== '' ? ' · '.h($uwxDatesLabel) : '').'</div></div>';
	$overallSummaryHtml .=     '</div>';

	$overallSummaryHtml .=     '<div class="osHero">';
	$overallSummaryHtml .=       '<div class="osScore">';
	$overallSummaryHtml .=         '<div class="osScoreRing"><canvas id="osScoreRing"></canvas><div class="osScoreText"><div class="n" id="osScoreNum">'.h($overallScore===null ? '—' : number_format((float)$overallScore, 1)).'</div><div class="l">Overall score (0–100)</div></div></div>';
	$overallSummaryHtml .=         '<div class="osScoreNote">Denominator: '.h((string)$osDen).' '.h($unitPlural).' under current selection.<br>Method: weighted score (DQA scoring method v8, same as the web application). Every standard check has a fixed weight ('.h($scorePeriodCount >= 2 ? 'multi-period weights: 2 or more periods selected' : '1-period weights: 1 month or 1 week selected').'); check score = 100 − % of '.h($unitPlural).' flagged; the weight of a check that cannot be run passes to the other checks. Completeness is not scored for U-WIN. The score always uses the standard checks, whatever is ticked in the filters.</div>';
	$overallSummaryHtml .=       '</div>';
	$overallSummaryHtml .=       '<div class="osMiniGrid" id="osComponentMini">';
	foreach($osMini as $mi){
		$dqa_ms = ($mi['score']===null) ? 'No check could be run' : 'Top issue: '.number_format((float)$mi['maxTot'],1).'%';
		$overallSummaryHtml .= '<div class="osMini"><div class="h">'.h($mi['name']).'</div><div class="row"><div class="pct">'.h($mi['score']===null ? 'N/A' : number_format((float)$mi['score'],1)).'</div><div class="sub">score</div></div><div class="sub">'.h($dqa_ms).'</div></div>';
	}
	$overallSummaryHtml .=       '</div>';
	$overallSummaryHtml .=     '</div>';
	/* the score working, check by check (as in the web application's score breakdown) */
	$overallSummaryHtml .=     '<div class="osSection" data-comp="working">';
	$overallSummaryHtml .=       '<div class="osSectionHead"><div class="h">Score working</div><div class="sub">Weight used × check score ÷ 100 = points; the points add up to the overall score</div></div>';
	$overallSummaryHtml .=       '<div class="osTableWrap" style="max-height:none"><table class="osTbl"><thead><tr><th>Component</th><th>Check</th><th>Weight</th><th>Weight used</th><th>'.h($unitTitle).' flagged</th><th>Check score</th><th>Points</th></tr></thead><tbody>';
	foreach($wScore['checks'] as $dqa_wc){
		$dqa_cn = isset($osComponents[$dqa_wc['comp']]) ? $osComponents[$dqa_wc['comp']]['name'] : $dqa_wc['comp'];
		$overallSummaryHtml .= '<tr><td>'.h($dqa_cn).'</td><td>'.h(display_text_with_fipv($dqa_wc['name'])).'</td><td>'.h(number_format($dqa_wc['w'],2)).'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['used'],2) : '0 (cannot run)').'</td><td>'.h($dqa_wc['run'] ? $dqa_wc['flagged'].' of '.$osDen : '—').'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['score'],1) : '—').'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['points'],2) : '—').'</td></tr>';
	}
	$overallSummaryHtml .=       '<tr><td colspan="6"><b>Overall score</b></td><td><b>'.h($overallScore===null ? '—' : number_format((float)$overallScore,1)).'</b></td></tr>';
	$overallSummaryHtml .=       '</tbody></table></div>';
	$overallSummaryHtml .=     '</div>';

	foreach($osComponents as $gid=>$g){
		$overallSummaryHtml .= '<div class="osSection" data-comp="'.h($gid).'">';
		$overallSummaryHtml .=   '<div class="osSectionHead"><div class="h">'.h($g['name']).'</div><div class="sub">Indicators violating expected data behaviour</div></div>';
		$overallSummaryHtml .=   '<div class="osSectionGrid">';
		$overallSummaryHtml .=     '<div class="osPanel">';
		$overallSummaryHtml .=       '<div class="osPanelTitle">Impact</div>';
		$anyW = min(100.0, max(0.0, (float)$g['maxAny']));
		$allW = min(100.0, max(0.0, (float)$g['maxAll']));
		$overallSummaryHtml .=       '<div class="osImpactBar" id="osImpact_'.h($gid).'"><div class="seg any" style="width:'.h(number_format($anyW,2)).'%"></div><div class="seg all" style="width:'.h(number_format($allW,2)).'%"></div></div>';
		$overallSummaryHtml .=       '<div class="osImpactLegend"><div class="osLegRow"><span class="dot any"></span>Any period <span class="v" id="osImpactAny_'.h($gid).'">'.h(number_format($anyW,1)).'%</span></div><div class="osLegRow"><span class="dot all"></span>All&nbsp;periods<br><span class="v" id="osImpactAll_'.h($gid).'">'.h(number_format($allW,1)).'%</span></div></div>';
		$overallSummaryHtml .=     '</div>';

		$overallSummaryHtml .=     '<div class="osPanel">';
		$overallSummaryHtml .=       '<div class="osPanelTitle">Top KPIs</div>';
		$overallSummaryHtml .=       '<div class="osTableWrap"><table class="osTbl" id="osTbl_'.h($gid).'"><thead><tr><th>KPI</th><th>'.h($unitTitle).'</th><th>%</th></tr></thead><tbody>';
		foreach($g['top'] as $r){
			$overallSummaryHtml .= '<tr><td>'.h($r['name']).'</td><td>'.h((string)$r['total']).'</td><td>'.h(number_format((float)$r['pct'],1)).'%</td></tr>';
		}
		if(empty($g['top'])){
			$overallSummaryHtml .= '<tr><td colspan="3">—</td></tr>';
		}
		$overallSummaryHtml .=       '</tbody></table></div>';
		$overallSummaryHtml .=     '</div>';

		$overallSummaryHtml .=     '<div class="osPanel osPanelHL">';
		$overallSummaryHtml .=       '<div class="osPanelTitle">Highlights</div>';
		$overallSummaryHtml .=       '<canvas class="osBar" id="osBar_'.h($gid).'"></canvas>';
		$overallSummaryHtml .=     '</div>';

		$overallSummaryHtml .=   '</div>';
		$overallSummaryHtml .= '</div>';
	}

	$overallSummaryHtml .=     '<div class="osFoot">Tip: Percentages use the '.h($unitPlural).' under the current selection as the denominator.</div>';
	$overallSummaryHtml .=   '</div>';
	$overallSummaryHtml .= '</div>';

	/* (added 2026-11) data of "Download Report" = the two-page DQA brief of the DQA web
	   application (U-WIN portal). assets/report/dqa_brief_report.js runs the web application's
	   own report code on it, so the report says and shows what the web application would for the
	   same files and selection: the units under the selection at the level on screen (named, and
	   grouped by block, as the web application names them), the standard score cards with the
	   units each flags, the selected periods and the declared From - To dates of the files. The
	   web application's "vs previous period" line needs its saved reviews, so it is left out. */
	$dqaBriefJson = 'null';
	$dqaBriefSrc = 'assets/report/dqa_brief_report.js';
	$dqaBriefSrc .= '?v='.(is_file(__DIR__.'/'.$dqaBriefSrc) ? (string)filemtime(__DIR__.'/'.$dqaBriefSrc) : '1');
	if($hasApplied){
		$dqaBriefIdx = []; $dqaBriefUnits = [];
		foreach($facFiltered as $dqa_k=>$dqa_u){
			$dqaBriefIdx[(string)$dqa_k] = count($dqaBriefUnits);
			$dqaBriefUnits[] = [(string)$dqa_u['facility'], ($dqa_u['subcenter'] === null ? null : (string)$dqa_u['subcenter']), ($dqa_u['sessionsite'] === null ? null : (string)$dqa_u['sessionsite']), (string)$dqa_u['block'], (string)$dqa_u['district']];
		}
		$dqaBriefCards = [];
		foreach($scoreCardsList as $c){
			$idx = []; foreach($c['stat']['keys'] as $k){ if(isset($dqaBriefIdx[(string)$k])) $idx[] = $dqaBriefIdx[(string)$k]; }
			$dqaBriefCards[] = ['id'=>(string)$c['id'], 'name'=>(string)$c['name'], 'group'=>(string)$c['group'], 'eligible'=>(int)$c['stat']['eligible'],
				'total'=>(int)$c['stat']['total'], 'any'=>(int)$c['stat']['any'], 'all'=>(int)$c['stat']['all'], 'units'=>$idx];
		}
		$dqaBriefData = [
			'v'=>1, 'portal'=>'UWIN',
			'state'=>(string)$stateName, 'district'=>(string)$distName,
			'mode'=>$uwxMode, 'months'=>array_values(array_map('strval', $selMonthKeysOrdered)),
			'periods'=>array_values($uwxPeriods),
			'den'=>(int)$osDen,
			'uploaded'=>['facility'=>$globalDen, 'subcenter'=>$scDen, 'sessionsite'=>$ssDen],
			'units'=>$dqaBriefUnits, 'cards'=>$dqaBriefCards,
		];
		$dqaJf = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE;
		if(defined('JSON_INVALID_UTF8_SUBSTITUTE')) $dqaJf |= JSON_INVALID_UTF8_SUBSTITUTE;
		$dqaBriefJson = json_encode($dqaBriefData, $dqaJf);
		if($dqaBriefJson === false) $dqaBriefJson = 'null';
	}

	$osData = ['overallScore'=>$overallScore,'components'=>$osComponents,'checks'=>$wScore['checks'],'method'=>8];
	$osDataJson = json_encode($osData);

?>
<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title><?=h($APP_NAME)?></title>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		:root{
			--bg:#f4f6fb;
			--panel:#ffffff;
			--text:#0f172a;
			--muted:#64748b;
			--border:#d1d5db;
			--group-avail:#0ea5e9;
--group-acc:#f97316;
			--group-cons:#22c55e;
			--nGreen:#dcfce7;
			--nGreenBorder:#86efac;
			--nGreenText:#14532d;
		}
		*{box-sizing:border-box}
		body{
			margin:0;
			background:radial-gradient(circle at top left,#e0f2fe 0,#eef2ff 40%,#f9fafb 100%);
			color:var(--text);
			font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}
		.container{max-width:1240px;margin:22px auto;padding:0 16px}
		h1{margin:0 0 6px;font-size:22px}

		.topbar{
			display:flex;justify-content:space-between;align-items:flex-start;gap:12px;
			margin-bottom:12px;padding:12px 14px;border-radius:16px;
			background:rgba(255,255,255,0.9);
			box-shadow:0 8px 24px rgba(15,23,42,.08);
			border:1px solid rgba(148,163,184,.35);
		}
		.top-meta{font-size:12px;color:var(--muted)}
		a.btn,button.btn{
			display:inline-block;padding:9px 13px;border-radius:999px;border:0;
			background:linear-gradient(135deg,#22d3ee,#6366f1);
			color:#fff;font-weight:700;text-decoration:none;
			box-shadow:0 6px 20px rgba(99,102,241,.25);
			cursor:pointer;font-size:13px;
		}
		button.btn.btnDisabled{
			background:#cbd5e1 !important;
			color:#64748b !important;
			box-shadow:none !important;
			cursor:not-allowed !important;
			opacity:.85;
		}
		a.btn + a.btn, a.btn + button.btn, button.btn + a.btn, button.btn + button.btn{margin-left:6px;}

		.infoRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px;}
		.statSmall{font-size:12px;color:var(--muted);margin-top:6px;font-weight:700}
		.uwxLevelNote{margin:0 0 12px;padding:10px 14px;border-radius:14px;border:1px solid rgba(59,130,246,.35);background:linear-gradient(90deg, rgba(239,246,255,.95), rgba(240,249,255,.95));color:#1e3a8a;font-size:13px;font-weight:600;}
		.levelToggle{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;background:#fff;border:1px solid rgba(148,163,184,.55);border-radius:14px;padding:4px;}
		.levelToggle .levelLbl{font-size:12px;font-weight:900;color:#334155;padding:0 6px;}
		.levelToggle button.levelBtn{border:1px solid transparent !important;border-radius:10px !important;padding:8px 12px !important;font-weight:800 !important;font-size:12.5px !important;background:#f8fafc !important;color:#475569 !important;cursor:pointer;box-shadow:none !important;transform:none !important;}
		.levelToggle button.levelBtn:hover{background:#eef2ff !important;color:#1e3a8a !important;}
		.levelToggle button.levelBtn.active{background:#1d4ed8 !important;color:#ffffff !important;border-color:#1d4ed8 !important;}
		.infoBox{
			background:rgba(255,255,255,.94);
			border:1px solid rgba(148,163,184,.45);
			border-radius:16px;
			padding:14px 16px;
			box-shadow:0 10px 24px rgba(15,23,42,.06);
		}
		.infoBox .title{font-weight:900;font-size:14px;margin:0 0 8px;}
		.statTitle{font-weight:900;color:#0f172a;font-size:13px}
		.statValue{font-weight:900;font-size:22px;color:#7c2d12;line-height:1.15;margin-top:4px;word-break:break-word}
		.statSmall{font-size:12px;color:var(--muted);margin-top:4px;font-weight:700}
		.infoGrid{display:grid;grid-template-columns:1fr;gap:8px;}
		.infoLine{
			display:flex;justify-content:space-between;gap:10px;
			padding:10px 12px;border-radius:14px;
			border:1px solid rgba(148,163,184,.30);
			background:linear-gradient(90deg, rgba(255,255,255,.96), rgba(240,249,255,.96));
		}
		.infoLine .k{font-weight:900;color:#0f172a}
		.infoLine .v{font-weight:900;color:#1d4ed8}
		.infoBig{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
		.infoMetric{
			padding:10px 12px;border-radius:14px;border:1px solid rgba(148,163,184,.30);background:#fff;
		}
		.infoMetric .mTitle{font-weight:900;color:#0f172a;font-size:13px}
		.infoMetric .mVal{font-weight:900;font-size:26px;color:#7c2d12;line-height:1.1;margin-top:4px}
		.infoMetric .mSmall{font-size:12px;color:var(--muted);margin-top:4px;font-weight:700}
		@media (max-width: 1200px){
			.infoRow{grid-template-columns:repeat(2,1fr)}
		}
		@media (max-width: 900px){
			.infoRow{grid-template-columns:1fr}
			.infoBig{grid-template-columns:1fr}
		}

		.componentsBox{
			background:rgba(255,255,255,.92);
			border:1px solid rgba(148,163,184,.45);
			border-radius:16px;
			padding:12px;
			box-shadow:0 8px 20px rgba(15,23,42,.06);
			margin-bottom:10px;
		}
		.componentsLabelBox{
			border:1px solid rgba(148,163,184,.35);
			border-radius:14px;
			padding:10px 12px;
			background:linear-gradient(90deg, rgba(255,255,255,.96), rgba(254,242,242,.96));
			box-shadow:0 6px 14px rgba(15,23,42,.05);
			margin-bottom:10px;
		}
		.componentsLabelText{font-weight:900;font-size:20px;color:#7c2d12;}
		.groupRow{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;}
		.groupCol{flex:1 1 240px;min-width:240px}
		.groupBtn{
			width:100%;
			border:0;border-radius:18px;padding:14px 18px;font-size:18px;font-weight:900;
			cursor:pointer;
			box-shadow:0 7px 0 rgba(148,163,184,.6), 0 12px 20px rgba(15,23,42,.18);
			transform:translateY(0);
			transition:transform .08s ease, box-shadow .12s ease, filter .12s ease;
		}
		.groupBtn:hover{transform:translateY(-1px);filter:brightness(1.03)}
		.groupBtn:active{transform:translateY(1px)}
		.groupBtn.active{outline:3px solid rgba(15,23,42,.12)}
		.groupBtn.availability{
			background:linear-gradient(145deg,rgba(224,242,254,0.98),rgba(191,219,254,0.98)) !important;
			background-color:#e0f2fe !important;
			color:#0369a1 !important;box-shadow:0 7px 0 rgba(37,99,235,.45),0 12px 22px rgba(59,130,246,.30) !important;
		}
		.groupBtn.accuracy{
			background:linear-gradient(145deg,rgba(255,237,213,0.98),rgba(254,215,170,0.98)) !important;
			background-color:#ffedd5 !important;
			color:#9a3412 !important;box-shadow:0 7px 0 rgba(234,88,12,.50),0 12px 22px rgba(249,115,22,.30) !important;
		}
		.groupBtn.consistency{
			background:linear-gradient(145deg,rgba(220,252,231,0.98),rgba(187,247,208,0.98)) !important;
			background-color:#dcfce7 !important;
			color:#166534 !important;box-shadow:0 7px 0 rgba(22,163,74,.50),0 12px 22px rgba(34,197,94,.30) !important;
		}

		.kpiBullets{
			margin:10px 0 0;
			padding:10px 12px 10px 18px;
			border-radius:14px;
			border:1px solid rgba(148,163,184,.35);
			background:rgba(255,255,255,.85);
			box-shadow:0 6px 14px rgba(15,23,42,.05);
			font-size:12px;
			color:#0f172a;
		}
		.kpiBullets li{margin:4px 0}
		.kpiBullets li.kpiHeaderNoBullet{list-style:none;margin-left:-18px;font-weight:900}

		.currentSelectionLine{
			display:none;
			margin:10px 0 12px;
			padding:12px 14px;
			border-radius:16px;
			border:1px solid rgba(148,163,184,.55);
			background:linear-gradient(90deg, rgba(255,255,255,.96), rgba(240,249,255,.96));
			box-shadow:0 10px 24px rgba(15,23,42,.06);
		}
		.currentSelectionLine .csLabel{font-size:20px;font-weight:900;color:#7c2d12;}
		.currentSelectionLine .csValue{font-size:20px;font-weight:900;color:#1d4ed8;}

		.filtersWrap{
			background:var(--panel);
			border:1px solid var(--border);
			border-radius:14px;
			padding:12px;
			margin:10px 0 14px;
			box-shadow:0 6px 18px rgba(15,23,42,.06);
			overflow:visible;
		}
		.filtersBox{
			border:1px solid rgba(148,163,184,.35);
			border-radius:14px;
			padding:10px;
			background:#fff;
			box-shadow:0 6px 14px rgba(15,23,42,.05);
			margin-bottom:10px;
			overflow:visible;
		}
		.filtersBoxTitle{font-weight:900;font-size:12px;color:#0f172a;margin-bottom:8px;}
		.filterRow{
			display:flex;
			flex-wrap:wrap;
			gap:8px;
			align-items:flex-start;
			overflow:visible;
			padding-bottom:2px;
			position:relative;
		}
		.filterGroup{
			background:#f9fafb;
			border:1px solid var(--border);
			border-radius:999px;
			padding:2px 10px;
			white-space:nowrap;
		}
		.filterGroup details{display:inline-block;position:relative;}
		.filterGroup summary{
			list-style:none;cursor:pointer;font-size:13px;font-weight:800;color:#111827;outline:none;
		}
		.filterGroup summary::-webkit-details-marker{display:none}
		.filterGroup summary::after{content:"▼";font-size:10px;margin-left:6px;color:#64748b;}
		.filterGroup details[open] summary::after{content:"▲";}
		.filterDropdown{
			position:absolute;z-index:9999;margin-top:6px;background:#fff;border:1px solid var(--border);
			border-radius:12px;box-shadow:0 14px 40px rgba(15,23,42,.18);
			padding:10px;max-height:none;overflow:visible;min-width:320px;
		}
		.chkWrap{max-height:none;overflow:visible;border-top:1px dashed #e2e8f0;margin-top:6px;padding-top:6px}
		.chk{display:block;font-size:13px;margin:2px 0}
		.small{font-size:12px;color:var(--muted)}
		.applyRow{display:flex;gap:8px;justify-content:flex-end;align-items:center;}
		.applyRow .btn{border-radius:10px;}

		.summaryBox{
			display:none;
			background:rgba(255,255,255,.92);
			border:1px solid rgba(148,163,184,.45);
			border-radius:14px;
			padding:12px;
			box-shadow:0 8px 18px rgba(15,23,42,.06);
			margin-bottom:10px;
		}
		.summaryTitle{font-weight:900;margin-bottom:10px;}
		.kpiGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;}
		.kpi{
			background:#fff;border:1px solid var(--border);border-radius:14px;padding:10px;
			display:flex;flex-direction:column;gap:6px;cursor:pointer;
			box-shadow:0 4px 12px rgba(15,23,42,.06);
		}
		.kpi h3{margin:0;font-size:12px;color:#fff;padding:6px 10px;border-radius:10px;display:inline-block;width:fit-content;}
		.kpi .num{font-size:22px;font-weight:900;margin-top:2px;}
		.kpi .split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px;}
		.kpi .splitCol{border:1px solid rgba(148,163,184,.45);border-radius:12px;padding:6px 8px;background:rgba(248,250,252,.9);}
		.kpi .splitLbl{font-size:11px;color:var(--muted);font-weight:800;}
		.kpi .splitVal{font-size:20px;font-weight:900;color:var(--text);margin-top:2px;}

		.kpi .splitTotal{text-align:center;margin-top:2px;}
		.kpi .splitTotalNum{font-size:26px;font-weight:900;color:var(--text);}
		.kpi .splitValNum{font-size:20px;font-weight:900;color:var(--text);}
		.kpi .unit{font-size:11px;font-weight:400;color:var(--muted);}
		.kpi .top3{font-size:11px;color:var(--text);opacity:.9;}
		.kpi .top3Row{margin-top:4px;}

		.kpi .unit{font-size:12px;color:#0f172a;opacity:.8;font-weight:600}
		.kpi:hover{box-shadow:0 8px 22px rgba(15,23,42,.12);}
		.kpi:active{transform:translateY(1px);}
		.kpi.group-availability h3{background:var(--group-avail);}
		.kpi.group-accuracy h3{background:var(--group-acc);}
		.kpi.group-consistency h3{background:var(--group-cons);}
		/* Separate colors for Consistency KPI cards */
		.kpi.group-consistency.kind-incons h3{background:#86efac;color:#14532d;}
		.kpi.group-consistency.kind-missed h3{background:#15803d;color:#ffffff;}
		.kpiCard[data-total="0"]{opacity:.55;cursor:not-allowed;}
		@media (max-width: 1200px){ .kpiGrid{grid-template-columns:repeat(3,1fr)} }
		@media (max-width: 900px){ .kpiGrid{grid-template-columns:repeat(2,1fr)} }
		@media (max-width: 640px){
			.kpiGrid{grid-template-columns:1fr}
			.topbar{flex-direction:column;align-items:flex-start}
		}

		.panelsWrap{
			display:none;
			background:rgba(255,255,255,.92);
			border:1px solid rgba(148,163,184,.45);
			border-radius:14px;
			padding:12px;
			box-shadow:0 8px 18px rgba(15,23,42,.06);
			margin-bottom:16px;
		}
		.panelsGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}
		@media (max-width: 900px){ .panelsGrid{grid-template-columns:1fr} }
		.panel{
			border:1px solid var(--border);
			border-radius:14px;
			background:#fff;
			padding:12px;
			box-shadow:0 4px 12px rgba(15,23,42,.06);
			height:470px;
			display:flex;
			flex-direction:column;
			overflow:hidden;
		}
		.panelHeader{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;flex:0 0 auto;}
.panelHeader{position:relative;}
.dlIcon{
    border:1px solid rgba(148,163,184,.65);
    background:linear-gradient(180deg,#ffffff 0%, #f3f6fb 55%, #eef2f7 100%);
    font-size:16px;
    line-height:16px;
    cursor:pointer;
    padding:7px 10px;
    border-radius:999px;
    box-shadow:0 10px 24px rgba(15,23,42,.12);
    transition:transform .10s ease, box-shadow .12s ease, background .12s ease;
}
.dlIcon:hover{transform:translateY(-1px);box-shadow:0 14px 30px rgba(15,23,42,.16);}
.dlIcon:active{transform:translateY(1px);box-shadow:0 6px 14px rgba(15,23,42,.10);background:linear-gradient(180deg,#eef2f7,#ffffff);} 
.dlIcon:focus{outline:none;box-shadow:0 0 0 3px rgba(37,99,235,.18), 0 10px 24px rgba(15,23,42,.12);} 

		.panelTitle{font-weight:900;font-size:14px}
		.panelControls{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
		.toggleGroup{display:inline-flex;align-items:center;}
		.toggleBtn{
			border:1px solid #cbd5e1;
			background:linear-gradient(180deg,#ffffff 0%, #f7fafc 100%);
			color:#0f172a;
			padding:7px 12px;
			font-weight:900;
			font-size:12px;
			cursor:pointer;
			border-radius:0;
			line-height:1;
			box-shadow:0 8px 18px rgba(15,23,42,.10);
			transition:transform .08s ease, box-shadow .10s ease, background .12s ease, filter .12s ease;
		}
		.toggleBtn + .toggleBtn{margin-left:-1px;}
		.toggleGroup .toggleBtn:first-child{border-top-left-radius:12px;border-bottom-left-radius:12px;}
		.toggleGroup .toggleBtn:last-child{border-top-right-radius:12px;border-bottom-right-radius:12px;}
		.toggleBtn.active{
			background:linear-gradient(180deg,#111827 0%, #0f172a 100%);
			color:#fff;
			border-color:#0f172a;
			box-shadow:inset 0 2px 4px rgba(255,255,255,.12), inset 0 -3px 8px rgba(0,0,0,.40), 0 4px 10px rgba(15,23,42,.22);
			text-shadow:0 1px 0 rgba(0,0,0,.35);
			transform:translateY(1px);
		}
		.toggleBtn:not(.active):hover{transform:translateY(-1px);filter:brightness(0.99);}
		.toggleBtn:active{transform:translateY(1px);}
		.toggleBtn:focus{outline:none;box-shadow:0 0 0 3px rgba(37,99,235,.16), 0 6px 14px rgba(15,23,42,.10);} 

		.viewport{
			margin-top:10px;
			border:1px solid var(--border);
			border-radius:12px;
			background:#fff;
			padding:8px;
			flex:1 1 auto;
			overflow:hidden;
			display:flex;
			min-height:0;
		}
		.chartBox{display:block;flex:1 1 auto;min-height:0;min-width:0;}
		.tableBox{display:none;flex:1 1 auto;min-height:0;min-width:0;}
		.chartStage{height:100%;min-height:0;}
		.chartStage canvas{width:100% !important;height:100% !important;display:block;}
		.tableStage{height:100%;overflow:auto;min-height:0;}
		/* Summary table: horizontal + vertical scrollbars */
		.summaryScroll{height:100%;overflow:auto;min-height:0;}
		.summaryScroll table{min-width:720px;}
		.tblWrap{min-width:720px;}
		table{border-collapse:collapse;width:100%;min-width:720px;background:#fff;}
		th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;vertical-align:top;font-size:12px;}
		th{background:#f9fafb;font-weight:900;}
		.twoHead .lvl1{background:#eef2ff;}
		.twoHead .lvl2{background:#f8fafc;}
		.nCell{background:var(--nGreen);border-color:var(--nGreenBorder) !important;color:var(--nGreenText);font-weight:900;}
		.issueCell{background:#fee2e2;border-color:#fca5a5 !important;color:#991b1b;font-weight:900;} /* (added) N = issue */
		.ynNote{font-size:11px;color:#475569;margin:6px 2px 2px;font-weight:600;} /* (added) legend under Y/N tables */
		.ynNoteBox{font-size:11px;color:#475569;margin-top:6px;flex:0 0 auto;font-weight:600;} /* (added) legend under Y/N panel boxes */
		.pinkCell{background:#ffc0cb;border-color:#fda4af !important;font-weight:900;}
		/* NEW: red highlight (Availability 'Y' cells and Consistency co-admin mismatch cells) */
		.redCell{background:#fecaca;border-color:#f87171 !important;color:#7f1d1d;font-weight:900;}

		.consGroupBox{
			border:1px solid rgba(148,163,184,.35);
			border-radius:14px;
			background:#fff;
			padding:10px;
			box-shadow:0 6px 14px rgba(15,23,42,.05);
			margin-bottom:10px;
		}
		.consGroupTitle{font-weight:900;font-size:13px;margin:0 0 10px;}

		/* pair-builder */
		.pairRow{display:flex;gap:6px;align-items:flex-start;margin-top:6px;flex-wrap:wrap;}
		.pairSelect{
			min-width:155px;
			padding:6px 8px;
			border:1px solid #cbd5e1;
			border-radius:10px;
			font-weight:800;
			background:#fff;
			height:auto;
		}
		.pairBtn{
			width:34px;height:34px;
			border-radius:10px;border:1px solid #cbd5e1;background:#fff;
			font-weight:900;cursor:pointer;line-height:1;
		}
		.pairBtn:hover{background:#f8fafc}
		.pairBtn:active{transform:translateY(1px)}

		@media print{
			.btn, .groupBtn, .filterGroup, .filtersWrap, .componentsBox { display:none !important; }
			.container{max-width:none;margin:0;padding:0}
			.panel{height:auto !important; overflow:visible !important;}
			.viewport{overflow:visible !important;}
			.tableStage{overflow:visible !important;}
		}
	

/* -------------------- Overall Score (Overlay) -------------------- */
#osOverlay{ position:fixed; inset:0; background:#f6f4ef; z-index:99999; display:none; overflow:auto; }
#osOverlay .osWrap{ max-width:1200px; margin:0 auto; padding:18px 16px 28px; }
#osOverlay .osTopbar{ position:sticky; top:0; z-index:5; background:rgba(246,244,239,0.92); backdrop-filter:saturate(180%) blur(10px); border-bottom:1px solid rgba(0,0,0,0.10); padding:12px 0; }
#osOverlay .osTopbarInner{ display:flex; align-items:flex-end; gap:12px; }
#osOverlay .osTitle{ font-size:26px; font-weight:900; color:#7a4b12; line-height:1.1; }
#osOverlay .osMeta{ font-size:13px; color:#666; margin-top:3px; }
#osOverlay .osBack{ margin-left:auto; display:flex; gap:10px; align-items:center; }

#osOverlay .osGrid3{ display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; margin-top:14px; }
#osOverlay .osGrid4{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-top:14px; }
@media (max-width: 980px){ #osOverlay .osGrid4, #osOverlay .osGrid3{ grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 560px){ #osOverlay .osGrid4, #osOverlay .osGrid3{ grid-template-columns:1fr; } }

#osOverlay .osCard{ background:#fff; border:1px solid rgba(0,0,0,0.10); border-radius:16px; padding:12px 12px; box-shadow:0 10px 25px rgba(0,0,0,0.06); }
#osOverlay .osCard .t{ font-size:12px; color:#6b7280; font-weight:800; letter-spacing:.02em; }
#osOverlay .osCard .k{ font-size:22px; font-weight:900; color:#111827; margin-top:4px; line-height:1.05; }
#osOverlay .osCard .k .sm{ font-size:12px; font-weight:600; color:#6b7280; margin-left:6px; }
#osOverlay .osCard .s{ font-size:12px; color:#6b7280; margin-top:2px; font-weight:700; }
#osOverlay .osCard .m{ font-size:12px; color:#374151; margin-top:6px; font-weight:700; }

#osOverlay .osHero{ display:grid; grid-template-columns: 340px 1fr; gap:12px; margin-top:12px; align-items:stretch; }
@media (max-width: 980px){ #osOverlay .osHero{ grid-template-columns:1fr; } }

#osOverlay .osScore{ background:#fff; border:1px solid rgba(0,0,0,0.10); border-radius:18px; padding:14px; box-shadow:0 10px 25px rgba(0,0,0,0.06); }
#osOverlay .osScoreRing{ position:relative; height:220px; }
#osOverlay .osScoreRing canvas{ width:100% !important; height:220px !important; }
#osOverlay .osScoreText{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
#osOverlay .osScoreText .n{ font-size:46px; font-weight:950; color:#111827; line-height:1; }
#osOverlay .osScoreText .l{ font-size:12px; font-weight:800; color:#6b7280; margin-top:4px; }
#osOverlay .osScoreNote{ margin-top:10px; font-size:12px; color:#6b7280; font-weight:700; line-height:1.35; }

#osOverlay .osMiniGrid{ display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }
@media (max-width: 560px){ #osOverlay .osMiniGrid{ grid-template-columns:1fr; } }
#osOverlay .osMini{ background:#fff; border:1px solid rgba(0,0,0,0.10); border-radius:16px; padding:12px; box-shadow:0 10px 25px rgba(0,0,0,0.06); }
#osOverlay .osMini .h{ font-size:14px; font-weight:900; margin-bottom:6px; }
#osOverlay .osMini .row{ display:flex; align-items:baseline; gap:10px; }
#osOverlay .osMini .pct{ font-size:26px; font-weight:950; color:#111827; }
#osOverlay .osMini .sub{ font-size:12px; font-weight:800; color:#6b7280; }

#osOverlay .osSection{ margin-top:14px; background:#fff; border:1px solid rgba(0,0,0,0.10); border-radius:18px; box-shadow:0 10px 25px rgba(0,0,0,0.06); overflow:hidden; }
#osOverlay .osSectionHead{ padding:12px 14px; border-bottom:1px solid rgba(0,0,0,0.08); background:linear-gradient(180deg,#ffffff,#fbfbfb); display:flex; align-items:baseline; gap:10px; }
#osOverlay .osSectionHead .h{ font-size:18px; font-weight:950; color:#111827; }
#osOverlay .osSectionHead .sub{ font-size:12px; font-weight:800; color:#6b7280; }

	/* Highlights charts moved to next line for full visibility */
	#osOverlay .osSectionGrid{ display:grid; grid-template-columns: 260px 1fr; gap:12px; padding:12px 14px 14px; }
@media (max-width: 1100px){ #osOverlay .osSectionGrid{ grid-template-columns:1fr; } }
	#osOverlay .osPanelHL{ grid-column: 1 / -1; }

#osOverlay .osPanel{ border:1px solid rgba(0,0,0,0.10); border-radius:14px; padding:10px 10px; background:#fff; }
#osOverlay .osPanelTitle{ font-size:13px; font-weight:900; color:#374151; margin-bottom:8px; }

#osOverlay .osImpactBar{ height:14px; border-radius:999px; background:#e5e7eb; overflow:hidden; display:flex; }
#osOverlay .osImpactBar .seg{ height:100%; }
#osOverlay .osImpactBar .seg.any{ background:#2563eb; }
#osOverlay .osImpactBar .seg.all{ background:#0f766e; }
#osOverlay .osImpactLegend{ display:block; margin-top:8px; font-size:13px; font-weight:800; color:#374151; }
#osOverlay .osImpactLegend .osLegRow{ display:flex; align-items:center; gap:10px; margin:3px 0; }
#osOverlay .osImpactLegend .dot{ width:10px; height:10px; border-radius:50%; display:inline-block; }
#osOverlay .osImpactLegend .dot.any{ background:#2563eb; }
#osOverlay .osImpactLegend .dot.all{ background:#0f766e; }
#osOverlay .osImpactLegend .v{ color:#111827; font-weight:950; }

#osOverlay .osTableWrap{ overflow:auto; max-height:200px; border-radius:10px; }
#osOverlay table.osTbl{ width:100%; border-collapse:collapse; font-size:13px; }
#osOverlay .osTbl th{ text-align:left; padding:8px 8px; background:#f3f4f6; border-bottom:1px solid rgba(0,0,0,0.10); font-weight:900; color:#374151; position:sticky; top:0; }
#osOverlay .osTbl td{ padding:7px 8px; border-bottom:1px solid rgba(0,0,0,0.06); font-weight:700; color:#111827; }
#osOverlay .osTbl td:nth-child(2), #osOverlay .osTbl td:nth-child(3){ text-align:right; white-space:nowrap; }
#osOverlay .osTbl tr:hover td{ background:#fbfbfb; }

#osOverlay canvas.osBar{ width:100% !important; height:280px !important; }
#osOverlay .osFoot{ margin-top:12px; font-size:13px; font-weight:800; color:#6b7280; }

/* -------------------- End Overall Score -------------------- */

</style>
	<?php echo uwin_theme_css_tag(); ?>
</head>
<body data-hasapplied="<?=h($hasAppliedFlag)?>" data-showoutliers="<?=h($showOutliersFlag)?>" data-showdropouts="<?=h($showDropoutsFlag)?>" data-justuploaded="<?=h($justUploadedFlag)?>">
<div class="container" id="pageRoot">
	<div class="topbar">
		<div>
			<h1><?=h($APP_NAME)?></h1>
			<div class="top-meta">Source file: <b><?=h($fileName)?></b></div>
		</div>
		<div>
			<button type="button" class="btn<?=($dqaBriefJson !== 'null' ? '' : ' btnDisabled')?>" id="btnPdf" data-src="<?=h($dqaBriefSrc)?>"<?=($dqaBriefJson !== 'null' ? '' : ' disabled')?> title="<?=($dqaBriefJson !== 'null' ? 'Download the DQA brief (PDF) of this analysis' : 'Press Apply Filter first')?>">Download Report</button>
			<button type="button" onclick="window.location.href='?dqa_logout=1';" title="Return to the DQA Tools page and remove your uploaded data from the server">Logout</button>
			<button type="button" onclick="window.location.href='https://www.datamgmt.in/dqa.php';">Main Page</button>
			<a class="btn" href="<?=h($BASE_URL)?>">Start Over (new file)</a>
		</div>
	</div>

	<div class="infoRow">
		<div class="infoBox">
			<div class="statTitle">State</div>
			<div class="statValue"><?=h($stateName)?></div>
		</div>
		<div class="infoBox">
			<div class="statTitle">District</div>
			<div class="statValue"><?=h($distName)?></div>
		</div>
		<div class="infoBox">
			<div class="statTitle">Duration</div>
			<div class="statValue"><?=$durationStrHtml?></div>
			<?php if($uwxDatesLabel !== ''): ?><div class="statSmall"><?=h(($uwxDur === 'WEEKLY' ? 'Weekly' : 'Monthly').' files: '.$uwxDatesLabel)?></div><?php endif; ?>
		</div>
		<div class="infoBox">
			<div class="statTitle">Number of Blocks</div>
			<div class="statValue"><?= (int)$globalBlocksCount ?></div>
		</div>
		<div class="infoBox">
			<div class="statTitle">Number of facilities</div>
			<div class="statValue"><?= (int)$globalDen ?></div>
		</div>
		<?php if($uwxC['idxSubCenter'] !== null): ?>
		<div class="infoBox">
			<div class="statTitle">Number of sub centers</div>
			<div class="statValue"><?= (int)$scDen ?></div>
		</div>
		<?php endif; ?>
		<?php if($uwxC['idxSessionSite'] !== null): ?>
		<div class="infoBox">
			<div class="statTitle">Number of session sites</div>
			<div class="statValue"><?= (int)$ssDen ?></div>
		</div>
		<?php endif; ?>
	</div>
	<div class="uwxLevelNote">Analysis level: <b><?=h($uwxModes[$uwxMode])?></b> &mdash; every check, % and the Overall Score count <?=h($unitPlural)?> (<?= (int)$selDen ?> under the current selection). Change it with the <b>Analysis level</b> switch in the filters. Scores recorded for this upload are always <?=h($uwxModes[$stdMode])?>, as in the DQA web application.</div>

	<div class="componentsBox">
		<div class="componentsLabelBox"><div class="componentsLabelText">Components of Data Quality</div></div>
		<div class="groupRow">
			<div class="groupCol">
				<button type="button" class="groupBtn availability" data-group="availability" title="All reports for the study period must be available in the portal at the time of assessment">Availability</button>
				<ul class="kpiBullets">					<li>Indicators having 0 values but not blank</li>
					<li>Indicators with same values</li>
					<li>Zero coverage session</li>
				</ul>
			</div>
<div class="groupCol">
				<button type="button" class="groupBtn accuracy" data-group="accuracy" title="Identification of logical errors and outliers in immunization data of UWIN portal">Accuracy</button>
				<ul class="kpiBullets">
					<li>Planned but not held</li>
					<li>Avg Beneficiaries per session &lt; 5</li>
					<li>Outliers</li>
					<li>Dropouts (selected pairs)</li>
				</ul>
			</div>

			<div class="groupCol">
				<button type="button" class="groupBtn consistency" data-group="consistency" title="Identification of discrepencies as per immunization logics">Consistency</button>
				<ul class="kpiBullets">
					<li class="kpiHeaderNoBullet"><b>Inconsistencies between doses</b></li>
					<li>Inconsistencies — Penta3&gt;Penta1</li>
					<li>Inconsistencies — MR2&gt;MR1</li>
					<li class="kpiHeaderNoBullet"><b>Inconsistencies between vaccines</b></li>
					<li>6 weeks — OPV1, Penta1, RVV1, PCV1, fIPV1</li>
					<li>10 weeks — OPV2, Penta2, RVV2</li>
					<li>14 weeks — OPV3, Penta3, RVV3, PCV2, fIPV2</li>
					<li>9 months — MR1, PCV Booster, fIPV3</li>
					<li>2 years — MR2, DPT 1st Booster</li>
				</ul>
			</div>
		</div>
	</div>

	<div class="currentSelectionLine" id="currentSelectionLine">
		<span class="csLabel">Detailed Analysis:</span>
		<span class="csValue" id="csValue"></span>
	</div>

	<div class="filtersWrap">
		<form method="post" id="filtersForm">
			<input type="hidden" name="action" value="refresh">
				<input type="hidden" name="access_code" value="<?=h($GLOBALS['ACCESS_CODE_CURRENT'])?>">
				<input type="hidden" name="dqa_uid" value="<?=h(isset($_SESSION['dqa_upload_id']) ? (string)$_SESSION['dqa_upload_id'] : '')?>">
			<input type="hidden" name="active_group" id="activeGroupInput" value="<?=h($initGroup)?>">

			<div class="filtersBox" id="filtersBoxSingle">
				<div class="filtersBoxTitle">Filters</div>

				<div class="filterRow">
					<!-- (added 2026-11, web parity) Analysis level: Facility-wise / Sub Center-wise / Session Site-wise -->
					<div class="filterGroup">
						<div class="levelToggle" role="group" aria-label="Analysis level">
							<span class="levelLbl">Analysis level</span>
							<input type="hidden" name="analysis_mode" id="analysisModeInput" value="<?=h($uwxMode)?>">
							<?php foreach($uwxModes as $dqa_lm=>$dqa_ll): ?>
								<button type="button" class="levelBtn<?=($dqa_lm===$uwxMode ? ' active' : '')?>" data-mode="<?=h($dqa_lm)?>" aria-pressed="<?=($dqa_lm===$uwxMode ? 'true' : 'false')?>"><?=h($dqa_ll)?></button>
							<?php endforeach; ?>
						</div>
					</div>
					<!-- Block -->
					<div class="filterGroup">
						<div class="filterShell">
							<details>
								<summary>LGD Block Name</summary>
								<div class="filterDropdown">
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="blocks[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach(array_keys($allBlocks) as $b): ?>
											<?php $chk = (empty($filters['blocks']) || in_array($b,$filters['blocks'],true)) ? 'checked' : ''; ?>
											<label class="chk">
												<input type="checkbox" name="blocks[]" value="<?=h($b)?>" <?=$chk?>> <?=h(display_block_label($b))?>
											</label>
										<?php endforeach; ?>
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- Months -->
					<?php if(!$singleMonthDataset): ?>
					<div class="filterGroup">
						<div class="filterShell">
							<details>
								<summary>Months</summary>
								<div class="filterDropdown">
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="months[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($allMonths as $mk=>$ml): ?>
											<?php $chk = (empty($filters['months']) || in_array($mk,$filters['months'],true)) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="months[]" value="<?=h($mk)?>" <?=$chk?>> <?=h($ml)?> (<?=h($mk)?>)</label>
										<?php endforeach; ?>
									</div>
								</div>
							</details>
						</div>
					</div>
					<?php endif; ?>

					<!-- Key Indicators (Accuracy only) -->
					<div class="filterGroup vaxOnly" style="display:none">
						<div class="filterShell">
							<details>
								<summary>Key Indicators</summary>
								<div class="filterDropdown">
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_vax[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($KEY_VAX as $vx): ?>
											<?php $chk = (in_array($vx,$filters['outliers_vax'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="outliers_vax[]" value="<?=h($vx)?>" <?=$chk?>> <?=h(display_vax_label($vx))?></label>
										<?php endforeach; ?>
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- Outliers (Accuracy only) -->
					<div class="filterGroup accOnly outOnly" style="display:none">
						<div class="filterShell">
							<details>
								<summary>Outliers</summary>
								<div class="filterDropdown">
									<input type="hidden" name="outliers_inc_present" value="1">
									<div class="small"><b>Increase buckets</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_inc[]"> Select All</label>
									<div class="chkWrap">
										<?php $incOpts=[['INC_LOW','25 to <50% Low'],['INC_MOD','50–100% Moderate'],['INC_EXT','>100% or from 0 Extreme']]; foreach($incOpts as $opt): $chk = (in_array($opt[0], (array)$filters['outliers_inc'], true)) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="outliers_inc[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

									<input type="hidden" name="outliers_drop_present" value="1">
									<div class="small" style="margin-top:6px"><b>Drop buckets</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_drop[]"> Select All</label>
									<div class="chkWrap">
										<?php $dropOpts=[['DROP_LOW','−25 to >−50% Low'],['DROP_MOD','−50 to >−75% Moderate'],['DROP_EXT','−75 to −100% Extreme']]; foreach($dropOpts as $opt): $chk = (in_array($opt[0], (array)$filters['outliers_drop'], true)) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="outliers_drop[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- Dropouts (Accuracy only) -->
					<div class="filterGroup accOnly dropOnly" style="display:none">
						<div class="filterShell">
							<details>
								<summary>Dropouts</summary>
								<div class="filterDropdown">
									<div class="small"><b>Dropout % ranges</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="drop_ranges[]"> Select All</label>
									<div class="chkWrap">
										<?php $drOpts=[ ['R5_10','5 to <10% (Low)'], ['R11_20','10 to <20% (Moderate)'], ['R20P','20% or more (High)'] ]; foreach($drOpts as $opt): $chk = (in_array($opt[0],$filters['drop_ranges'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="drop_ranges[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

									<div class="small" style="margin-top:8px"><b>Pairs</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="drop_pairs[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($PAIR_DEFAULTS as $pr): ?>
											<?php $chk = (in_array($pr,$filters['drop_pairs'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="drop_pairs[]" value="<?=h($pr)?>" <?=$chk?>> <?=h($pr)?></label>
										<?php endforeach; ?>
									</div>

									<div class="small" style="margin-top:8px"><b>Vaccine-1 / Vaccine-2 (any pair)</b></div>
									<div id="pairRows">
										<?php for($ri=0;$ri<$pairRowCount;$ri++): ?>
											<?php $selFrom = isset($dropFromSel[$ri]) ? (string)$dropFromSel[$ri] : ''; $selTo = isset($dropToSel[$ri]) ? (string)$dropToSel[$ri] : ''; ?>
											<div class="pairRow">
												<select name="drop_from[]" class="pairSelect">
													<option value="" <?=($selFrom===''?'selected':'')?>>Vaccine-1</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selFrom) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h(display_vax_label($vx))?></option>
													<?php endforeach; ?>
												</select>

												<select name="drop_to[]" class="pairSelect">
													<option value="" <?=($selTo===''?'selected':'')?>>Vaccine-2</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selTo) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h(display_vax_label($vx))?></option>
													<?php endforeach; ?>
												</select>

												<button type="button" class="pairBtn pairRemove" title="Remove">×</button>
											</div>
										<?php endfor; ?>
									</div>

									<div class="pairRow" style="margin-top:8px">
										<button type="button" class="pairBtn" id="pairAdd" title="Add">+</button>
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- NEW: Inconsistencies (Consistency only) - before Additional Filter -->
					<div class="filterGroup consOnly" style="display:none">
						<div class="filterShell">
							<details>
								<summary>Inconsistencies between Vaccines/doses</summary>
								<div class="filterDropdown">
									<div class="small" style="margin-top:2px"><b>Vaccine-1 / Vaccine-2 (any pair)</b></div>

									<div id="inconsPairRows">
										<?php for($ri=0;$ri<$inconsPairRowCount;$ri++): ?>
											<?php $selFrom = isset($inconsFromSel[$ri]) ? (string)$inconsFromSel[$ri] : ''; $selTo = isset($inconsToSel[$ri]) ? (string)$inconsToSel[$ri] : ''; ?>
											<div class="pairRow">
												<select name="incons_from[]" class="pairSelect">
													<option value="" <?=($selFrom===''?'selected':'')?>>Vaccine-1</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selFrom) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h(display_vax_label($vx))?></option>
													<?php endforeach; ?>
												</select>

												<select name="incons_to[]" class="pairSelect">
													<option value="" <?=($selTo===''?'selected':'')?>>Vaccine-2</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selTo) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h(display_vax_label($vx))?></option>
													<?php endforeach; ?>
												</select>

												<button type="button" class="pairBtn inconsPairRemove" title="Remove">×</button>
											</div>
										<?php endfor; ?>
									</div>

									<div class="pairRow" style="margin-top:8px">
										<button type="button" class="pairBtn" id="inconsPairAdd" title="Add">+</button>
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- Additional Filter (LAST) -->
					<div class="filterGroup additionalFilterGroup">
						<div class="filterShell">
							<details>
								<summary>Additional Filter</summary>
								<div class="filterDropdown">
									<!-- Additional Indicators -->
									<div class="addVaxWrap" style="margin-top:8px;">
										<div class="small"><b>Additional Indicators</b></div>
										<label class="chk"><input type="checkbox" data-role="selectall" data-target="add_vax[]"> Select All</label>
										<div class="chkWrap">
											<?php foreach($ADD_VAX as $vx): ?>
												<?php $chk = (!empty($filters['add_vax']) && in_array($vx,$filters['add_vax'],true)) ? 'checked' : ''; ?>
												<label class="chk"><input type="checkbox" name="add_vax[]" value="<?=h($vx)?>" <?=$chk?>> <?=h(display_vax_label($vx))?></label>
											<?php endforeach; ?>
										</div>
									</div>
								</div>
							</details>
						</div>
					</div>

					<div class="applyRow" style="margin-left:auto">
						<button type="submit" class="btn">Apply Filter</button>
						<button type="button" class="btn osBtn" id="overallSummaryBtn" style="display:none;">Overall Score</button>
					</div>
				</div>
			</div>
		</form>
	</div>

	<div class="summaryBox" id="summaryBox">
		<div class="summaryTitle" id="summaryTitle">Indicators Summary</div>
		<div class="kpiGrid" id="kpiGrid"><?=$kpiCardsHtml?></div>
		<div id="kpiGridConsistency" style="display:none;margin-top:10px">
			<div class="consGroupBox" id="consKpiVaccinesBox">
				<div class="consGroupTitle">Inconsistencies between doses</div>
				<div class="kpiGrid"><?=$kpiCardsHtmlConsIncons?></div>
			</div>
			<div class="consGroupBox" id="consKpiDosesBox">
				<div class="consGroupTitle">Inconsistencies between vaccines</div>
				<div class="kpiGrid"><?=$kpiCardsHtmlConsMissed?></div>
			</div>
		</div>
	</div>

	<div class="panelsWrap" id="panelsWrap">
		<div class="panelsGrid" id="panelsMain"><?=implode("\n",$panelBlocks['main'])?></div>

		<div id="consistencyGroups" style="display:none;margin-top:10px">
			<div class="consGroupBox" id="consInaccurateBox">
				<div class="consGroupTitle">Inconsistencies between doses</div>
				<div class="panelsGrid"><?=implode("\n",$panelBlocks['cons_incons'])?></div>
			</div>
			<div class="consGroupBox" id="consMissedBox">
				<div class="consGroupTitle">Inconsistencies between vaccines</div>
				<div class="panelsGrid"><?=implode("\n",$panelBlocks['cons_missed'])?></div>
			</div>
		</div>
	</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
	<?=$overallSummaryHtml?>

<script>
const BASE_URL = "<?=h($BASE_URL)?>";
const CHARTS = <?= $chartsJson ? $chartsJson : "{}" ?>;
window.__OS_DATA__ = <?= $osDataJson ? $osDataJson : 'null' ?>;
window.__DQA_BRIEF__ = <?= isset($dqaBriefJson) ? $dqaBriefJson : 'null' ?>; /* (added 2026-11) Download Report data */
const hasApplied = document.body.getAttribute('data-hasapplied') === '1';
const showOutliers = document.body.getAttribute('data-showoutliers') === '1';
const showDropouts = document.body.getAttribute('data-showdropouts') === '1';
const justUploaded = document.body.getAttribute('data-justuploaded') === '1';

const chartsInstances = {};

// Data labels on all charts (values above bars)
const valueLabelsPlugin = {
    id: 'valueLabelsPlugin',
    afterDatasetsDraw(chart, args, pluginOptions){
        // Do NOT draw generic value labels on Overall Score overlay charts.
        // Overall Score uses its own % label plugin; drawing here causes duplicate/cluttered labels.
        try{
            if(chart && chart.canvas && chart.canvas.id){
                const cid = String(chart.canvas.id);
                if(cid === 'osScoreRing' || cid.indexOf('osBar_') === 0){
                    return;
                }
            }
        }catch(e){}
        const ctx = chart.ctx;
        if(!ctx) return;
        const ds = chart.data && chart.data.datasets ? chart.data.datasets : [];
        if(!ds.length) return;
        ctx.save();
        ctx.font = 'bold 11px system-ui, -apple-system, Segoe UI, Roboto, Arial';
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for(let di=0; di<ds.length; di++){
            const meta = chart.getDatasetMeta(di);
            if(!meta || !meta.data) continue;
            meta.data.forEach((el, idx)=>{
                const v = ds[di].data ? ds[di].data[idx] : null;
                if(v === null || typeof v === 'undefined') return;
                const val = (typeof v === 'number') ? v : parseFloat(v);
                if(isNaN(val)) return;
                const p = el.tooltipPosition ? el.tooltipPosition() : {x: el.x, y: el.y};
                ctx.fillText(String(val), p.x, p.y - 4);
            });
        }
        ctx.restore();
    }
};
try{ if(window.Chart && Chart.register){ Chart.register(valueLabelsPlugin); } }catch(e){}

function closeAllDetails(exceptEl){
	document.querySelectorAll('.filterGroup details[open]').forEach(d=>{
		if(exceptEl && d === exceptEl) return;
		d.removeAttribute('open');
	});
}
function ensureDropdownVisible(detailsEl){
	const dropdown = detailsEl.querySelector('.filterDropdown');
	if(!dropdown) return;
	const r = dropdown.getBoundingClientRect();
	const pad = 14;
	const vh = window.innerHeight || document.documentElement.clientHeight;
	if(r.bottom > vh - pad){
		const diff = (r.bottom - (vh - pad));
		window.scrollBy({top: diff + 18, left:0, behavior:'smooth'});
	}
}
function bindDropdownAutoScroll(){
	document.querySelectorAll('.filterGroup details').forEach(details=>{
		details.addEventListener('toggle', ()=>{
			if(details.open){
				closeAllDetails(details);
				setTimeout(()=>ensureDropdownVisible(details), 60);
			}
		});
	});
	document.addEventListener('click', (e)=>{
		const within = e.target.closest('.filterGroup details');
		if(!within){ closeAllDetails(null); }
	});
}
function bindSelectAll(){
	document.querySelectorAll('input[type="checkbox"][data-role="selectall"]').forEach(cb=>{
		cb.addEventListener('change', ()=>{
			const targetName = cb.getAttribute('data-target');
			if(!targetName) return;
			const scope = cb.closest('.filterDropdown') || document;
			const boxes = scope.querySelectorAll('input[type="checkbox"][name="'+targetName+'"]');
			boxes.forEach(b=>{ b.checked = cb.checked; });
		});
	});
}
function setCurrentSelection(group){
	const line = document.getElementById('currentSelectionLine');
	const value = document.getElementById('csValue');
	if(!group){
		line.style.display='none';
		return;
	}
	line.style.display='block';
	value.textContent = group.charAt(0).toUpperCase() + group.slice(1);
}
function setActiveGroupBtn(group){
	document.querySelectorAll('.groupBtn').forEach(btn=>{
		btn.classList.toggle('active', btn.getAttribute('data-group') === group);
	});
}
function showGroupFilters(group){
	const vaxOnly = document.querySelectorAll('.vaxOnly');
	const accOnly = document.querySelectorAll('.accOnly');
	const outOnly = document.querySelectorAll('.outOnly');
	const dropOnly = document.querySelectorAll('.dropOnly');
	const consOnly = document.querySelectorAll('.consOnly');
	const addWrap = document.querySelectorAll('.addVaxWrap');
	const addFilterGroups = document.querySelectorAll('.additionalFilterGroup');

	const isAcc = group === 'accuracy';
	const isCons = group === 'consistency';
	const isAvail = group === 'availability';

	vaxOnly.forEach(el=>{ el.style.display = isAcc ? '' : 'none'; });
	accOnly.forEach(el=>{ el.style.display = isAcc ? '' : 'none'; });
	outOnly.forEach(el=>{ el.style.display = (isAcc && showOutliers) ? '' : 'none'; });
	dropOnly.forEach(el=>{ el.style.display = (isAcc && showDropouts) ? '' : 'none'; });

	/* NEW: show inconsistencies pair builder only for Consistency */
	consOnly.forEach(el=>{ el.style.display = isCons ? '' : 'none'; });
	addWrap.forEach(el=>{ el.style.display = isAcc ? '' : 'none'; });
	// (changed 2026-10) the 'Additional Filter' dropdown holds only Additional Indicators: shown with Accuracy only
	addFilterGroups.forEach(el=>{ el.style.display = isAcc ? '' : 'none'; });
}

/* CHANGED: always hide zero-value panels (chart/table) */
function applyZeroPanelHiding(scope){
	(scope || document).querySelectorAll('.panel').forEach(p=>{
		const total = parseInt(p.getAttribute('data-total') || '0', 10);
		if(total <= 0){
			p.style.display = 'none';
		}
	});
}

function showGroupKpis(group){
	const summary = document.getElementById('summaryBox');
	const panels = document.getElementById('panelsWrap');
	const panelsMain = document.getElementById('panelsMain');
	const consGroups = document.getElementById('consistencyGroups');

	if(!hasApplied){
		summary.style.display = 'none';
		panels.style.display = 'none';
		return;
	}

	summary.style.display = 'block';
	panels.style.display = 'block';

	// KPI containers (Consistency shows two separate KPI groups)
	const gridMain = document.getElementById('kpiGrid');
	const gridCons = document.getElementById('kpiGridConsistency');
	if(gridMain && gridCons){
		if(group === 'consistency'){
			gridMain.style.display = 'none';
			gridCons.style.display = 'block';
		} else {
			gridMain.style.display = '';
			gridCons.style.display = 'none';
		}
	}

	// KPI cards filter
	document.querySelectorAll('.kpiCard').forEach(card=>{
		const g = card.getAttribute('data-group');
		card.style.display = (g === group) ? '' : 'none';
	});

	// Panels filter
	if(group === 'consistency'){
		panelsMain.style.display = 'none';
		consGroups.style.display = 'block';

		/* NEW: hide empty consistency boxes if all their panels are hidden */
		const boxA = document.getElementById('consInaccurateBox');
		const boxM = document.getElementById('consMissedBox');

		applyZeroPanelHiding(consGroups);

		function boxHasVisiblePanels(box){
			if(!box) return false;
			const ps = box.querySelectorAll('.panel');
			for(let i=0;i<ps.length;i++){
				if(ps[i].style.display !== 'none') return true;
			}
			return false;
		}

		if(boxA) boxA.style.display = boxHasVisiblePanels(boxA) ? '' : 'none';
		if(boxM) boxM.style.display = boxHasVisiblePanels(boxM) ? '' : 'none';

	} else {
		panelsMain.style.display = 'grid';
		consGroups.style.display = 'none';

		panelsMain.querySelectorAll('.panel').forEach(p=>{
			const g = p.getAttribute('data-group');
			const total = parseInt(p.getAttribute('data-total') || '0', 10);
			/* CHANGED: hide panels with total 0 */
			p.style.display = (g === group && total > 0) ? '' : 'none';
		});
	}

	// Render charts for visible panels
	renderVisibleCharts();
}

function renderChartFor(id){
	const canvas = document.getElementById('canvas-' + id);
	if(!canvas) return;
	const payload = CHARTS[id];
	if(!payload) return;
	const labels = payload.labels || [];
	const values = payload.values || [];
	const panelEl = document.getElementById('panel-' + id);
	const grp = panelEl ? (panelEl.getAttribute('data-group') || '') : '';
	const cssVar = (name, fb) => { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name); return (v && v.trim()) ? v.trim() : fb; } catch(e){ return fb; } };
	const groupPalette = {
		availability: cssVar('--group-avail', '#2563eb'),
		accuracy: cssVar('--group-acc', '#f97316'),
		consistency: cssVar('--group-cons', '#22c55e')
	};
	const bgFill = payload.color || groupPalette[grp] || '#0ea5e9';
	if(labels.length === 0) return;

	if(chartsInstances[id]){
		try { chartsInstances[id].destroy(); } catch(e){}
		chartsInstances[id] = null;
	}

	chartsInstances[id] = new Chart(canvas.getContext('2d'), {
		type: 'bar',
		data: {
			labels: labels,
			datasets: [{
				label: '',
				data: values,
				backgroundColor: bgFill,
				borderWidth: 0
			}]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: { legend: { display: false }, tooltip: { enabled: true } },
			scales: {
				x: { ticks: { font: { size: 11 } } },
				y: { beginAtZero: true, ticks: { precision: 0, font: { size: 11 } } }
			}
		}
	});
}

function renderVisibleCharts(){
	document.querySelectorAll('.panel').forEach(panel=>{
		if(panel.style.display === 'none') return;
		const total = parseInt(panel.getAttribute('data-total') || '0', 10);
		if(total <= 0) return;
		const id = panel.id.replace('panel-','');
		renderChartFor(id);
	});
}

function bindPanelToggles(){
	document.querySelectorAll('.toggleBtn').forEach(btn=>{
		btn.addEventListener('click', ()=>{
			const id = btn.getAttribute('data-target');
			const view = btn.getAttribute('data-view');
			const panel = document.getElementById('panel-' + id);
			if(!panel) return;

			const chartBox = document.getElementById('chartBox-' + id);
			const tableBox = document.getElementById('tableBox-' + id);

			const summaryBox = panel.querySelector('.summaryBoxKpi');
			const tableStage = tableBox ? tableBox.querySelector('.tableStage') : null;

			panel.querySelectorAll('.toggleBtn[data-target="'+id+'"]').forEach(b=>b.classList.remove('active'));
			btn.classList.add('active');

			if(view === 'chart'){
				if(chartBox) chartBox.style.display = 'block';
				if(tableBox) tableBox.style.display = 'none';
				renderChartFor(id);
			} else if(view === 'table'){
				if(chartBox) chartBox.style.display = 'none';
				if(tableBox) tableBox.style.display = 'block';
				if(tableStage) tableStage.style.display = 'block';
				if(summaryBox) summaryBox.style.display = 'none';
			} else { // summary
				if(chartBox) chartBox.style.display = 'none';
				if(tableBox) tableBox.style.display = 'block';
				if(tableStage) tableStage.style.display = 'none';
				if(summaryBox) summaryBox.style.display = 'block';
			}
		});
	});
}


function downloadCurrentForPanel(id){
	const panel = document.getElementById('panel-' + id);
	if(!panel) return;
	const dlKey = panel.getAttribute('data-dlkey') || '';
	const ttlEl = panel.querySelector('.panelTitle');
	let title = ttlEl ? (ttlEl.textContent || '').trim() : id;
	if(!title) title = id;
	const safeName = title.replace(/[^A-Za-z0-9 _\-]+/g,'').replace(/\s+/g,' ').trim().replace(/\s/g,'_');
	const activeBtn = panel.querySelector('.toggleBtn.active[data-target="'+id+'"]');
	const view = activeBtn ? (activeBtn.getAttribute('data-view') || 'chart') : 'chart';

	if(view === 'chart'){
		const canvas = document.getElementById('canvas-' + id);
		if(!canvas) return;
		try{
			const a = document.createElement('a');
			a.download = (safeName || id) + '-Chart.png';
			a.href = canvas.toDataURL('image/png');
			document.body.appendChild(a);
			a.click();
			a.remove();
		}catch(e){}
		return;
	}

	if(view === 'table'){
		const tableBox = document.getElementById('tableBox-' + id);
		if(!tableBox) return;
		const stage = tableBox.querySelector('.tableStage');
		if(!stage) return;
		const style = `<style>
			table{border-collapse:collapse;width:100%;min-width:720px;background:#fff;}
			th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;vertical-align:top;font-size:12px;}
			th{background:#f9fafb;font-weight:900;}
			.twoHead .lvl1{background:#eef2ff;}
			.twoHead .lvl2{background:#f8fafc;}
			.nCell{background:#d1fae5;border-color:#86efac !important;color:#065f46;font-weight:900;}
			.issueCell{background:#fee2e2;border-color:#fca5a5 !important;color:#991b1b;font-weight:900;}
			.ynNote{font-size:11px;color:#475569;margin:6px 2px 2px;font-weight:600;}
			.pinkCell{background:#ffc0cb;border-color:#fda4af !important;font-weight:900;}
			.redCell{background:#fecaca;border-color:#f87171 !important;color:#7f1d1d;font-weight:900;}
		</style>`;
		const html = '<html><head><meta charset="utf-8">'+style+'</head><body>'
			+ '<div style="font-weight:900;font-size:14px;margin-bottom:8px;">'+(title.replace(/</g,'&lt;').replace(/>/g,'&gt;'))+'</div>'
			+ stage.innerHTML + '</body></html>';
		const blob = new Blob([html], {type: 'application/vnd.ms-excel'});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = (safeName || id) + '-Table.xls';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(()=>URL.revokeObjectURL(url), 4000);
		return;
	}

	// summary
	const sumBox = panel.querySelector('.summaryBoxKpi');
	if(!sumBox) return;
	const style = `<style>
		table{border-collapse:collapse;width:100%;min-width:720px;background:#fff;}
		th,td{border:1px solid #cbd5e1;padding:8px 10px;text-align:left;vertical-align:top;font-size:12px;}
		th{background:#f9fafb;font-weight:900;}
	</style>`;
	const html = '<html><head><meta charset="utf-8">'+style+'</head><body>'
		+ '<div style="font-weight:900;font-size:14px;margin-bottom:8px;">'+(title.replace(/</g,'&lt;').replace(/>/g,'&gt;'))+'</div>'
		+ sumBox.innerHTML + '</body></html>';
	const blob = new Blob([html], {type: 'application/vnd.ms-excel'});
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = (safeName || id) + '-Summary.xls';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

function bindDownloadIcons(){
	document.querySelectorAll('.dlIcon').forEach(btn=>{
		btn.addEventListener('click', ()=>{
			const id = btn.getAttribute('data-target');
			if(!id) return;
			downloadCurrentForPanel(id);
		});
	});
}

function bindKpiClick(){
	document.querySelectorAll('.kpiCard').forEach(card=>{
		card.addEventListener('click', ()=>{
			const total = parseInt(card.getAttribute('data-total') || '0', 10);
			if(total <= 0) return;
			const target = card.getAttribute('data-target');
			const panel = document.getElementById('panel-' + target);
			if(!panel) return;

			// Ensure panel is visible
			panel.scrollIntoView({behavior:'smooth', block:'start'});
			panel.classList.add('panelFocus');
			setTimeout(()=>panel.classList.remove('panelFocus'), 1100);
		});
	});
}

function bindPdf(){
	/* (changed 2026-11) Download Report: the DQA brief of the DQA web application. Its script
	   (assets/report/dqa_brief_report.js, with its fonts) is loaded on the first click. */
	const btn = document.getElementById('btnPdf');
	if(!btn) return;
	let loading = null;
	const loadReport = function(){
		if(window.DQABriefReport) return Promise.resolve();
		if(!loading){
			loading = new Promise(function(resolve, reject){
				const sc = document.createElement('script');
				sc.src = btn.getAttribute('data-src') || 'assets/report/dqa_brief_report.js';
				sc.onload = function(){ window.DQABriefReport ? resolve() : reject(new Error('report script')); };
				sc.onerror = function(){ loading = null; reject(new Error('report script')); };
				document.head.appendChild(sc);
			});
		}
		return loading;
	};
	btn.addEventListener('click', function(){
		if(btn.disabled) return;
		if(!window.__DQA_BRIEF__){ alert('Press Apply Filter first, then download the report.'); return; }
		const label = btn.textContent;
		btn.disabled = true;
		btn.textContent = 'Preparing report…';
		loadReport()
			.then(function(){ return window.DQABriefReport.download(window.__DQA_BRIEF__); })
			.catch(function(){ alert('The report could not be generated. Please check your connection and try again.'); })
			.then(function(){ btn.disabled = false; btn.textContent = label; });
	});
	/* (added 2026-11) Analysis level switch: applies the filters at the chosen level */
	document.querySelectorAll('.levelBtn').forEach(function(b){
		b.addEventListener('click', function(){
			const input = document.getElementById('analysisModeInput');
			const form = document.getElementById('filtersForm');
			if(!input || !form || input.value === b.getAttribute('data-mode')) return;
			input.value = b.getAttribute('data-mode');
			form.submit();
		});
	});
}

function bindGroupButtons(){
	const input = document.getElementById('activeGroupInput');
	document.querySelectorAll('.groupBtn').forEach(btn=>{
		btn.addEventListener('click', ()=>{
			const g = btn.getAttribute('data-group') || '';
			if(input) input.value = g;
			setActiveGroupBtn(g);
			setCurrentSelection(g);
			showGroupFilters(g);
			// If already applied, show KPIs for current group.
			showGroupKpis(g);
			// Scroll into view
			const wrap = document.querySelector('.filtersWrap');
			if(wrap) wrap.scrollIntoView({behavior:'smooth', block:'start'});
		});
	});
}

/* pair-builder add/remove rows for Dropouts */
function bindPairBuilder(){
	const addBtn = document.getElementById('pairAdd');
	const container = document.getElementById('pairRows');
	if(!addBtn || !container) return;

	function bindRemoveButtons(scope){
		(scope || document).querySelectorAll('.pairRemove').forEach(btn=>{
			if(btn.__bound) return;
			btn.__bound = true;
			btn.addEventListener('click', ()=>{
				const row = btn.closest('.pairRow');
				if(!row) return;
				// keep at least one row
				if(container.querySelectorAll('.pairRow').length <= 1){
					const fromSel = row.querySelector('select[name="drop_from[]"]');
					const toSel = row.querySelector('select[name="drop_to[]"]');
					if(fromSel) fromSel.value = '';
					if(toSel) toSel.value = '';
					return;
				}
				row.remove();
			});
		});
	}
	bindRemoveButtons(container);

	addBtn.addEventListener('click', ()=>{
		const first = container.querySelector('.pairRow');
		if(!first) return;
		const clone = first.cloneNode(true);
		clone.querySelectorAll('select').forEach(s=>{ s.value = ''; });
		container.appendChild(clone);
		bindRemoveButtons(clone);
	});
}

/* NEW: pair-builder add/remove rows for Inconsistencies */
function bindInconsPairBuilder(){
	const addBtn = document.getElementById('inconsPairAdd');
	const container = document.getElementById('inconsPairRows');
	if(!addBtn || !container) return;

	function bindRemoveButtons(scope){
		(scope || document).querySelectorAll('.inconsPairRemove').forEach(btn=>{
			if(btn.__bound) return;
			btn.__bound = true;
			btn.addEventListener('click', ()=>{
				const row = btn.closest('.pairRow');
				if(!row) return;
				// keep at least one row
				if(container.querySelectorAll('.pairRow').length <= 1){
					const fromSel = row.querySelector('select[name="incons_from[]"]');
					const toSel = row.querySelector('select[name="incons_to[]"]');
					if(fromSel) fromSel.value = '';
					if(toSel) toSel.value = '';
					return;
				}
				row.remove();
			});
		});
	}
	bindRemoveButtons(container);

	addBtn.addEventListener('click', ()=>{
		const first = container.querySelector('.pairRow');
		if(!first) return;
		const clone = first.cloneNode(true);
		clone.querySelectorAll('select').forEach(s=>{ s.value = ''; });
		container.appendChild(clone);
		bindRemoveButtons(clone);
	});
}

function init(){
	bindDropdownAutoScroll();
	bindSelectAll();
	bindPanelToggles();
	bindDownloadIcons();
	bindKpiClick();
	bindPdf();
	bindGroupButtons();
	bindPairBuilder();
	bindInconsPairBuilder();

	// Initial: restore previous group if valid; otherwise default to Availability
	let initGroup = (document.getElementById('activeGroupInput') && document.getElementById('activeGroupInput').value) ? document.getElementById('activeGroupInput').value : '';
	const allowedGroups = ['availability','accuracy','consistency'];
	if(!allowedGroups.includes(initGroup)) initGroup = allowedGroups[0];
	if(initGroup){
		setActiveGroupBtn(initGroup);
		setCurrentSelection(initGroup);
		showGroupFilters(initGroup);
		showGroupKpis(initGroup);
	} else {
		// Default filter visibility: none group-selected
		showGroupFilters('');
	}

	/* If just uploaded, ensure page at top */
	if(justUploaded){
		window.scrollTo({top:0,left:0,behavior:'auto'});
	}

	/* Ensure any zero panels remain hidden */
	applyZeroPanelHiding(document);
}


/* Overall Score overlay handlers */
(function(){
	var btn = document.getElementById('overallSummaryBtn');
	var ov = document.getElementById('osOverlay');
	var back = document.getElementById('osBackBtn');
	var pdf = document.getElementById('osPdfBtn');
	var hasApplied = document.body.getAttribute('data-hasapplied') === '1';

	function renderOsCharts(){
		if(typeof Chart==='undefined') return;
		if(!window.__OS_DATA__) return;
		var data = window.__OS_DATA__;
			var compColors = {
				availability: '#1d4ed8',
				accuracy: '#9a3412',
				consistency: '#047857'
			};
			// Draw value labels above bars (no external plugins). Values are already in percent.
			var osValueLabelPlugin = {
				id:'osValueLabelPlugin',
				afterDatasetsDraw:function(chart){
					var ctx = chart.ctx;
					var meta = chart.getDatasetMeta(0);
					if(!meta || !meta.data) return;
					ctx.save();
					ctx.fillStyle = '#111';
					ctx.textAlign = 'center';
					ctx.textBaseline = 'bottom';
					ctx.font = 'bold 12px Arial';
					meta.data.forEach(function(bar, i){
						var v = (chart.data.datasets[0].data[i]||0);
						var label = (Math.round(v*10)/10).toString() + '%';
						var p = bar.tooltipPosition();
						ctx.fillText(label, p.x, p.y - 4);
					});
					ctx.restore();
				}
			};
		// Score ring
		/* (changed 2026-10) no unit under the selection -> no score: a plain grey ring, not a "0" ring */
		var noScore = (data.overallScore === null || data.overallScore === undefined);
		var score = noScore ? 0 : Math.max(0, Math.min(100, Math.round(data.overallScore||0)));
		var ctx = document.getElementById('osScoreRing');
		if(ctx && !ctx.__chart){
			ctx.__chart = new Chart(ctx.getContext('2d'), {
				type:'doughnut',
				data: noScore ? { labels:[''], datasets:[{ data:[100], backgroundColor:['#e5e7eb'], borderWidth:0 }] }
				              : { labels:['Score',''], datasets:[{ data:[score, 100-score], borderWidth:0 }] },
				options:{
					responsive:true,
					maintainAspectRatio:false,
					cutout:'72%',
					plugins:{ legend:{ display:false }, tooltip:{ enabled:false } }
				}
			});
		}
		// Component bar charts
		// Wrap x-axis labels so they stay aligned (Overall Score screen only)
		function osWrapXAxisLabel(lbl, maxLen){
			lbl = (lbl===null || lbl===undefined) ? '' : String(lbl);
			maxLen = maxLen || 14;
			if(lbl.length <= maxLen) return lbl;
			// Prefer word-wrapping; fall back to hard wrap.
			var words = lbl.split(/\s+/).filter(Boolean);
			if(words.length <= 1){
				var out=[]; for(var i=0;i<lbl.length;i+=maxLen){ out.push(lbl.slice(i,i+maxLen)); } return out;
			}
			var lines=[]; var line='';
			words.forEach(function(w){
				if(!line){ line=w; return; }
				if((line + ' ' + w).length <= maxLen){ line = line + ' ' + w; }
				else { lines.push(line); line = w; }
			});
			if(line) lines.push(line);
			return lines;
		}

		var comps = data.components || {};
		Object.keys(comps).forEach(function(gid){
			var c = comps[gid];
			var top = (c && c.top) ? c.top : [];
				var labels = top.map(function(r){ return r.name; }).slice(0,7);
				var values = top.map(function(r){ return Math.round((r.pct||0)*10)/10; }).slice(0,7);
				var maxV = 0;
				values.forEach(function(v){ if(v>maxV) maxV=v; });
				var dynMax = 10;
				if(maxV <= 0){ dynMax = 10; }
				else {
					dynMax = Math.min(100, Math.ceil(maxV * (maxV < 10 ? 2.0 : 1.25) + 1));
					if(dynMax < 10) dynMax = 10;
				}
			var cv = document.getElementById('osBar_'+gid);
			if(cv && !cv.__chart){
				cv.__chart = new Chart(cv.getContext('2d'), {
					type:'bar',
						data:{ labels:labels, datasets:[{ data:values, backgroundColor:(compColors[gid]||'#334155'), borderRadius:8, borderSkipped:false }] },
					options:{
						responsive:true,
						maintainAspectRatio:false,
							layout:{ padding:{ top:18, right:10, bottom:28, left:10 } },
							plugins:{ legend:{ display:false }, tooltip:{ enabled:true } },
						scales:{
								x:{ ticks:{ autoSkip:false, maxRotation:0, minRotation:0, font:{ size:12 }, color:'#000', callback:function(value){ var lbl = (this && this.getLabelForValue) ? this.getLabelForValue(value) : value; return osWrapXAxisLabel(lbl, 14); } }, grid:{ display:false } },
								y:{ ticks:{ callback:function(v){ return v+'%'; }, font:{ size:12 }, color:'#000' }, beginAtZero:true, suggestedMax:dynMax, max:dynMax }
						}
					}
						,plugins:[osValueLabelPlugin]
				});
			}
		});

	}




	if(btn && ov){
		if(hasApplied){
			btn.style.display = 'inline-block';
		}
		btn.addEventListener('click', function(){
			if(!hasApplied) return;
			ov.style.display='block';
			ov.setAttribute('aria-hidden','false');
			ov.scrollTop = 0;
			window.scrollTo(0,0);
			renderOsCharts();
		});
	}
	if(back && ov){
		back.addEventListener('click', function(){
			ov.style.display='none';
			ov.setAttribute('aria-hidden','true');
		});
	}
	if(pdf){
		pdf.addEventListener('click', function(){
			// Print current Overall Score view as PDF via browser print dialog
			window.print();
		});
	}
})();


init();
</script>
<?php dqa_idle_script(); ?>
</body>
</html>
<?php
}
