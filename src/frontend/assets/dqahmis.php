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
	$dqa_keys = array('csv_header','csv_norm','csv_rows','idxBlock','idxFac','idxMonth','idxOwner','idxRU','idxState','idxDist','idxSubCentre','file_name','file_names','filters','hasApplied','just_uploaded','exports','pink_fac_sets','pink_outlier_hits','pink_dropout_hits','pink_repeat_hits','allMonthsMap','drop_pair_map','incons_pair_map','dqa_access_granted','dqa_last_seen','dqa_log_id','dqa_log_state','dqa_launch','dqa_launch_logid','dqa_hl','dqa_upload_id','dqa_upload_tool','dqa_upload_sig','dqa_render_id');
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
 */



$APP_NAME = "Data Quality Assessment - Desk Review";
$BASE_URL = basename(__FILE__);
/* IMPORTANT: Do not hardcode real credentials here in shared code. */
$DB_HOST = 'localhost';
$DB_USER = 'YOUR_DB_USER';
$DB_PASS = 'YOUR_DB_PASS';
$DB_NAME = 'YOUR_DB_NAME';
$STORE_TO_DB = false; // meta only (kept off)
$DEBUG = isset($_GET['debug']) ? 1 : 0;

/* Strong anti-cache */
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

/* Errors */
ini_set('display_errors', $DEBUG ? '1' : '0');
if ($DEBUG) { error_reporting(E_ALL); }
ini_set('log_errors', '1');
ini_set('error_log', sys_get_temp_dir() . '/dqa_desk_review.log');

/* -------------------- Resource limits for large uploads --------------------
   HMIS exports can contain up to ~50,000 rows. Default limits (often 128M memory)
   are exhausted while parsing/analysing large files, which PHP reports as HTTP 500.
   We raise the ceilings at runtime. These only REQUEST higher limits; if the host
   enforces a lower hard cap, that cap still applies, so this stays non-destructive.
   NOTE: upload_max_filesize / post_max_size cannot be changed from PHP at runtime;
   for very large CSVs they must be raised in the host php.ini / cPanel settings. */
@ini_set('memory_limit', '1024M');
@ini_set('max_execution_time', '300');
@set_time_limit(300);

/*session_start();*/

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
    <title>Access</title>
    <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;}
        .box{max-width:520px;margin:10vh auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px 24px;box-shadow:0 18px 40px rgba(2,6,23,.08);}
        h1{margin:0 0 8px 0;font-size:20px;color:#0f172a;}
        p{margin:0 0 16px 0;color:#475569;font-size:14px;line-height:1.45}
        input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;outline:none}
        input:focus{border-color:#64748b;box-shadow:0 0 0 4px rgba(100,116,139,.18)}
        button{margin-top:12px;width:100%;padding:12px 14px;border:0;border-radius:12px;background:#1d4ed8;color:#fff;font-weight:800;font-size:15px;cursor:pointer}
        .err{margin-top:10px;color:#b91c1c;font-weight:800;font-size:13px;}
    </style></head><body>
    <div class="box">
        <h1>HMIS Data Quality Assessment - Access Code Required</h1>
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
function strip_bom($s){ if(substr((string)$s,0,3)==="\xEF\xBB\xBF") return substr((string)$s,3); return (string)$s; }
function normalize_header($s){
	$s = strip_bom((string)$s);
	$s = trim($s);
	$s = preg_replace('/\s+/u',' ',$s);
	if(function_exists('mb_strtolower')) return mb_strtolower($s);
	return strtolower($s);
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
	$ts = strtotime((string)$raw);
	if($ts===false) return (string)$raw;
	return date('M',$ts);
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
	/* (changed 2026-10, web parity) same reading as the web application (parseUtils.ts
	   asNumOrNull): blank, NA, N/A, null and "-" are blank; thousands commas and spaces
	   between digits are removed ("1,250" = 1250); otherwise the first number in the text
	   is used ("12*" = 12). */
	if($v===null) return null;
	$s = trim(str_replace("\xC2\xA0", ' ', strip_bom((string)$v)));
	if($s==='') return null;
	if(in_array(strtolower($s), array('na','n/a','null','-'), true)) return null;
	$s = str_replace(',', '', $s);
	$s = preg_replace('/(?<=\d)\s+(?=\d)/', '', $s);
	if(preg_match('/^[+-]?\d+(?:\.\d+)?$/', $s)) return (float)$s;
	if(preg_match('/[+-]?\d+(?:\.\d+)?/', $s, $m)) return (float)$m[0];
	return null;
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

/** Expanded target indicator detection */
function detect_target_indicator($headerOriginal){
	$first = strip_bom($headerOriginal);
	$first = trim($first);
	/* (added 2026-10, web parity) HMIS "delayed vaccination" items (9.3.x) are separate data
	   items, never the regular vaccine column */
	if(preg_match('/\bdelayed\b/i', $first)) return null;
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
		['code'=>'9.1.11.','short'=>'fIPV1'],
		['code'=>'9.1.12.','short'=>'fIPV2'],
		['code'=>'9.2.1.','short'=>'fIPV3'],
		['code'=>'9.1.16.','short'=>'PCV1'],
		['code'=>'9.1.17.','short'=>'PCV2'],
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
	return null;
}


/** Short name for any indicator column (after Month) */
function indicator_short_from_header($headerOriginal){
	$h = strip_bom(trim((string)$headerOriginal));
	$low = function_exists('mb_strtolower') ? mb_strtolower($h) : strtolower($h);

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
		/* (added) tolerant match for the same name, tried before the next
		   (lower-priority) name: column names may change slightly in future
		   exports (case, extra/missing spaces, "_", "-", "/", ".", ":" etc.),
		   e.g. "Block_Name", "BlockName", "Facility Name:" or "Rural / Urban"
		   still match "block name", "facility name" and "rural/urban". An exact
		   match is always checked first. Columns are found by name, never by
		   position. */
		$cc = dqa_header_compact($cand);
		if($cc!==''){
			foreach($normHeader as $i=>$h){
				if(dqa_header_compact($h)===$cc) return $i;
			}
		}
	}
	return null;
}

/* ---- (added) helpers for tolerant header matching and .xlsx uploads ----
   dqa_header_compact()  : header text reduced to lower-case letters/digits only
                           (used for tolerant column-name matching).
   dqa_upload_is_xlsx()  : true when the upload is an Excel .xlsx workbook - by
                           file extension, or by the ZIP signature, so a workbook
                           that was renamed to .csv is still read correctly.
   dqa_xlsx_read_rows()  : reads the worksheet into plain rows of text cells, i.e.
                           exactly the shape fgetcsv() gives for a .csv file, so the
                           header detection (report title rows, two-row HMIS header),
                           column finding and the whole analysis below are shared
                           unchanged by both file types. */
function dqa_header_compact($s){
	$s = strip_bom((string)$s);
	$s = str_replace("\xC2\xA0", ' ', $s);
	$s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
	$c = @preg_replace('/[^\p{L}\p{N}]+/u', '', $s);
	if($c === null) $c = preg_replace('/[^a-z0-9]+/', '', $s); /* invalid UTF-8 fallback */
	return (string)$c;
}
function dqa_upload_is_xlsx($path, $origName){
	$ext = strtolower(pathinfo((string)$origName, PATHINFO_EXTENSION));
	if($ext === 'xlsx') return true;
	$fh = @fopen($path, 'rb');
	if(!$fh) return false;
	$sig = fread($fh, 4);
	fclose($fh);
	return ($sig === "PK\x03\x04");
}
/* 0-based column index from a cell reference such as "AK5" */
function dqa_xlsx_col_index($ref){
	if(!preg_match('/^([A-Za-z]+)/', (string)$ref, $m)) return null;
	$col = 0;
	$L = strtoupper($m[1]);
	for($i = 0, $n = strlen($L); $i < $n; $i++){ $col = $col * 26 + (ord($L[$i]) - 64); }
	return $col - 1;
}
/* true when an Excel number format code displays a date */
function dqa_xlsx_is_date_format($code){
	$c = (string)$code;
	$c = preg_replace('/"[^"]*"/', '', $c);       /* quoted literal text */
	$c = preg_replace('/\\\\./', '', $c);           /* escaped characters */
	$c = preg_replace('/\[[^\]]*\]/', '', $c);     /* [colour], [$-409], [h] ... */
	$c = strtolower($c);
	if(strpos($c, 'general') !== false) return false;
	return (bool)preg_match('/[dy]/', $c) || (strpos($c, 'm') !== false && !preg_match('/[hs]/', $c));
}
/* true when an Excel number format code shows the day of the month */
function dqa_xlsx_format_has_day($code){
	$c = (string)$code;
	$c = preg_replace('/"[^"]*"/', '', $c);
	$c = preg_replace('/\\\\./', '', $c);
	$c = preg_replace('/\[[^\]]*\]/', '', $c);
	return (bool)preg_match('/d/i', $c);
}
/* text of an <si> / <is> element: every <t> except phonetic <rPh> runs */
function dqa_xlsx_read_text($xr, $endName){
	$txt = '';
	if($xr->isEmptyElement) return $txt;
	$depth = $xr->depth;
	$inPh = 0;
	while($xr->read()){
		if($xr->nodeType === XMLReader::END_ELEMENT){
			if($xr->localName === $endName && $xr->depth === $depth) break;
			if($xr->localName === 'rPh') $inPh--;
			continue;
		}
		if($xr->nodeType !== XMLReader::ELEMENT) continue;
		if($xr->localName === 'rPh'){ if(!$xr->isEmptyElement) $inPh++; continue; }
		if($xr->localName === 't' && $inPh === 0 && !$xr->isEmptyElement){ $txt .= $xr->readString(); }
	}
	return $txt;
}
/* numeric cell text as Excel shows it in a CSV (no exponent / float noise) */
function dqa_xlsx_number_text($v){
	$v = trim((string)$v);
	if($v === '' || preg_match('/^-?\d+$/', $v)) return $v;
	if(!is_numeric($v)) return $v;
	$f = (float)$v;
	if(floor($f) == $f && abs($f) < 1e15) return sprintf('%.0f', $f);
	$t = rtrim(rtrim(sprintf('%.10F', $f), '0'), '.');
	return ($t === '-0') ? '0' : $t;
}
/* Excel date serial -> text ("d-m-Y", or "M-Y" when the format has no day) */
function dqa_xlsx_date_text($serial, $hasDay, $date1904){
	$f = (float)$serial;
	$days = (int)floor($f);
	$secs = (int)round(($f - $days) * 86400);
	if($secs >= 86400){ $days++; $secs -= 86400; }
	$base = $date1904 ? gmmktime(0, 0, 0, 1, 1, 1904) : gmmktime(0, 0, 0, 12, 30, 1899);
	$ts = $base + $days * 86400 + $secs;
	if(!$hasDay) return gmdate('M-Y', $ts);
	return ($secs > 0) ? gmdate('d-m-Y H:i:s', $ts) : gmdate('d-m-Y', $ts);
}
function dqa_xlsx_read_rows($path, &$err){
	$err = '';
	if(!class_exists('ZipArchive') || !class_exists('XMLReader')){
		$err = 'Excel (.xlsx) files cannot be read on this server. Please upload the .csv file instead.';
		return null;
	}
	$zip = new ZipArchive();
	if($zip->open($path) !== true){
		$err = 'Cannot open the uploaded Excel (.xlsx) file. Please check the file, or upload the .csv file instead.';
		return null;
	}

	/* workbook: sheets in tab order + date system */
	$sheets = array(); $date1904 = false;
	$wb = $zip->getFromName('xl/workbook.xml');
	if($wb !== false){
		$xr = new XMLReader();
		if(@$xr->XML($wb, null, LIBXML_NONET | LIBXML_COMPACT)){
			while(@$xr->read()){
				if($xr->nodeType !== XMLReader::ELEMENT) continue;
				if($xr->localName === 'workbookPr'){
					$d = strtolower((string)$xr->getAttribute('date1904'));
					$date1904 = ($d === '1' || $d === 'true');
				} elseif($xr->localName === 'sheet'){
					$rid = $xr->getAttributeNs('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
					if($rid === null || $rid === '') $rid = $xr->getAttribute('r:id');
					$sheets[] = array('rid' => (string)$rid, 'state' => (string)$xr->getAttribute('state'));
				}
			}
			$xr->close();
		}
	}
	$targets = array();
	$rels = $zip->getFromName('xl/_rels/workbook.xml.rels');
	if($rels !== false){
		$xr = new XMLReader();
		if(@$xr->XML($rels, null, LIBXML_NONET | LIBXML_COMPACT)){
			while(@$xr->read()){
				if($xr->nodeType === XMLReader::ELEMENT && $xr->localName === 'Relationship'){
					$t = str_replace('\\', '/', (string)$xr->getAttribute('Target'));
					if($t === '') continue;
					if($t[0] === '/') $t = ltrim($t, '/'); else $t = 'xl/' . $t;
					$parts = array();
					foreach(explode('/', $t) as $p){
						if($p === '..'){ array_pop($parts); } elseif($p !== '' && $p !== '.'){ $parts[] = $p; }
					}
					$targets[(string)$xr->getAttribute('Id')] = implode('/', $parts);
				}
			}
			$xr->close();
		}
	}
	$entries = array();
	foreach($sheets as $sh){ /* visible sheets first, in tab order */
		if($sh['state'] === '' || $sh['state'] === 'visible'){
			if(isset($targets[$sh['rid']]) && $zip->locateName($targets[$sh['rid']]) !== false) $entries[] = $targets[$sh['rid']];
		}
	}
	foreach($sheets as $sh){
		if(isset($targets[$sh['rid']]) && $zip->locateName($targets[$sh['rid']]) !== false && !in_array($targets[$sh['rid']], $entries, true)) $entries[] = $targets[$sh['rid']];
	}
	if(empty($entries)){ /* fallback: worksheet parts by name */
		for($i = 0; $i < $zip->numFiles; $i++){
			$n = $zip->getNameIndex($i);
			if(preg_match('#^xl/worksheets/[^/]+\.xml$#i', (string)$n)) $entries[] = $n;
		}
		natsort($entries); $entries = array_values($entries);
	}
	if(empty($entries)){
		$zip->close();
		$err = 'No worksheet found in the uploaded Excel (.xlsx) file.';
		return null;
	}

	/* shared strings */
	$sst = array();
	$ss = $zip->getFromName('xl/sharedStrings.xml');
	if($ss !== false){
		$xr = new XMLReader();
		if(@$xr->XML($ss, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE)){
			while(@$xr->read()){
				if($xr->nodeType === XMLReader::ELEMENT && $xr->localName === 'si'){ $sst[] = dqa_xlsx_read_text($xr, 'si'); }
			}
			$xr->close();
		}
		unset($ss);
	}

	/* styles: which cell styles are dates, and whether they show the day */
	$builtinFmt = array(14=>'mm-dd-yy',15=>'d-mmm-yy',16=>'d-mmm',17=>'mmm-yy',22=>'m/d/yy h:mm',
		27=>'yyyy"年"m"月"',28=>'m"月"d"日"',29=>'m"月"d"日"',30=>'m-d-yy',31=>'yyyy"年"m"月"d"日"',
		34=>'yyyy"年"m"月"',35=>'m"月"d"日"',36=>'yyyy"年"m"月"',50=>'yyyy"年"m"月"',51=>'m"月"d"日"',
		52=>'yyyy"年"m"月"',53=>'m"月"d"日"',54=>'m"月"d"日"',57=>'yyyy"年"m"月"',58=>'m"月"d"日"');
	$customFmt = array(); $xfDate = array();
	$st = $zip->getFromName('xl/styles.xml');
	if($st !== false){
		$xr = new XMLReader();
		if(@$xr->XML($st, null, LIBXML_NONET | LIBXML_COMPACT)){
			$inXfs = false; $xfIdx = 0;
			while(@$xr->read()){
				if($xr->nodeType === XMLReader::END_ELEMENT && $xr->localName === 'cellXfs'){ $inXfs = false; continue; }
				if($xr->nodeType !== XMLReader::ELEMENT) continue;
				if($xr->localName === 'numFmt'){
					$customFmt[(int)$xr->getAttribute('numFmtId')] = (string)$xr->getAttribute('formatCode');
				} elseif($xr->localName === 'cellXfs'){
					$inXfs = !$xr->isEmptyElement; $xfIdx = 0;
				} elseif($inXfs && $xr->localName === 'xf' && $xr->depth === 2){
					$id = (int)$xr->getAttribute('numFmtId');
					$code = isset($customFmt[$id]) ? $customFmt[$id] : (isset($builtinFmt[$id]) ? $builtinFmt[$id] : '');
					if($code !== '' && dqa_xlsx_is_date_format($code)){ $xfDate[$xfIdx] = dqa_xlsx_format_has_day($code); }
					$xfIdx++;
				}
			}
			$xr->close();
		}
		unset($st);
	}

	/* worksheets: first one (tab order) that carries the report header row */
	$firstRows = null;
	foreach($entries as $entry){
		$rows = array();
		$xr = new XMLReader();
		$opened = @$xr->open('zip://' . $path . '#' . $entry, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
		if(!$opened){
			$xml = $zip->getFromName($entry);
			$opened = ($xml !== false) && @$xr->XML($xml, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
			unset($xml);
		}
		if(!$opened) continue;
		$row = null; $nextCol = 0; $prevR = 0;
		while(@$xr->read()){
			if($xr->nodeType === XMLReader::END_ELEMENT && $xr->localName === 'row'){
				if($row !== null){ $rows[] = $row; $row = null; }
				continue;
			}
			if($xr->nodeType !== XMLReader::ELEMENT) continue;
			if($xr->localName === 'row'){
				/* rows that Excel leaves out of the file (completely empty rows) are
				   kept as blank rows, as in a .csv saved from the same sheet */
				$rn = (int)$xr->getAttribute('r');
				if($rn > 0){
					$gap = min($rn - $prevR - 1, 1000);
					for($g = 0; $g < $gap; $g++) $rows[] = array('');
					$prevR = $rn;
				} else {
					$prevR++;
				}
				$row = array(); $nextCol = 0;
				if($xr->isEmptyElement){ $rows[] = array(''); $row = null; }
				continue;
			}
			if($xr->localName !== 'c' || $row === null) continue;
			$ci = dqa_xlsx_col_index((string)$xr->getAttribute('r'));
			if($ci === null) $ci = $nextCol;
			$nextCol = $ci + 1;
			$type = (string)$xr->getAttribute('t');
			$sIdx = (int)$xr->getAttribute('s');
			$v = null; $inline = null;
			if(!$xr->isEmptyElement){
				$cDepth = $xr->depth;
				while($xr->read()){
					if($xr->nodeType === XMLReader::END_ELEMENT && $xr->localName === 'c' && $xr->depth === $cDepth) break;
					if($xr->nodeType !== XMLReader::ELEMENT) continue;
					if($xr->localName === 'v'){ $v = $xr->isEmptyElement ? '' : $xr->readString(); }
					elseif($xr->localName === 'is'){ $inline = dqa_xlsx_read_text($xr, 'is'); }
				}
			}
			if($type === 's'){
				$val = ($v !== null && isset($sst[(int)$v])) ? $sst[(int)$v] : '';
			} elseif($type === 'inlineStr'){
				$val = ($inline !== null) ? $inline : (string)$v;
			} elseif($type === 'b'){
				$val = ($v === null || $v === '') ? '' : (((string)$v === '1') ? 'TRUE' : 'FALSE');
			} elseif($type === 'str' || $type === 'e' || $type === 'd'){
				$val = (string)$v;
			} else { /* number (t="n" or no type) */
				if($v === null || trim((string)$v) === ''){
					$val = '';
				} elseif(isset($xfDate[$sIdx]) && is_numeric($v)){
					$val = dqa_xlsx_date_text($v, $xfDate[$sIdx], $date1904);
				} else {
					$val = dqa_xlsx_number_text($v);
				}
			}
			for($k = count($row); $k < $ci; $k++) $row[$k] = '';
			$row[$ci] = $val;
		}
		$xr->close();
		while(!empty($rows)){ /* drop trailing empty rows */
			$last = end($rows); $blank = true;
			foreach($last as $cv){ if(trim((string)$cv) !== ''){ $blank = false; break; } }
			if(!$blank) break;
			array_pop($rows);
		}
		foreach($rows as $k => $rr){ if(empty($rr)) $rows[$k] = array(''); }
		if($firstRows === null) $firstRows = $rows;
		$found = false;
		foreach(array_slice($rows, 0, 30) as $rr){
			foreach($rr as $cv){
				if(in_array(dqa_header_compact($cv), array('blockname','facilityname','month','healthblockname','sessionsitename'), true)){ $found = true; break 2; }
			}
		}
		if($found){ $zip->close(); return $rows; }
		unset($rows);
	}
	$zip->close();
	if($firstRows === null){
		$err = 'Cannot read the worksheet of the uploaded Excel (.xlsx) file.';
		return null;
	}
	return $firstRows;
}

/* ---- (added) Y/N legend ----
   dqa_yn_note()         : legend shown under every Y/N matrix (Y = no issue,
                           N = issue found) with the KPI-specific meaning.
   (2026-10, web parity: the FIC>MR1 and Public-Typhoid helpers were removed with
   those two checks, which the web application does not have.) */
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
   (2026-10, web parity: dqa_coadmin_odd() was replaced by dqa_coadmin_out_of_range();
   it and the other check rules shared with the web application are in the "web
   parity" block below.) */
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
	if((string)$_SESSION['dqa_upload_tool'] !== 'dqahmis') return $msg;
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
/* ==================================================================
   (added 2026-10) Web parity: the check rules, the KPI evaluators and the
   weighted score of the DQA web application (scoring method v8), so both
   tools give the same flags and the same score for the same file and
   selection. Each helper names the web-application source it mirrors.
   ================================================================== */

/* Month key $b (YYYY-MM) is the calendar month after $a. Month-on-month checks
   (Duplicate Monthly Record, Outliers) compare only such pairs
   (parseUtils.ts periodsAreConsecutive). */
function dqa_months_adjacent($a, $b){
	$pa = explode('-', (string)$a); $pb = explode('-', (string)$b);
	if(count($pa) !== 2 || count($pb) !== 2) return false;
	return ((int)$pb[0] * 12 + (int)$pb[1]) - ((int)$pa[0] * 12 + (int)$pa[1]) === 1;
}
/* M9 Child Immunisation columns: headers starting "9." + digit; every column after Month
   when the file carries no item codes (parseUtils.ts hmisAvailabilityColumns). */
function dqa_m9_columns($header, $idxMonth){
	$all = array(); $m9 = array();
	for($ci = $idxMonth + 1; $ci < count($header); $ci++){
		$all[] = $ci;
		if(preg_match('/^\s*9\.\d/', (string)$header[$ci])) $m9[] = $ci;
	}
	return !empty($m9) ? $m9 : $all;
}
/* M9 items that Key Missing Indicators leaves out: JE (all doses), delayed MR 1st dose
   and Typhoid (keyMissing.ts isKeyMissingExcludedItem). */
function dqa_key_missing_excluded($name){
	$t = dqa_unit_norm($name);
	if(preg_match('/\btyphoid\b/u', $t)) return true;
	if(preg_match('/\bje\b/u', $t) || preg_match('/\bjapanese encephalitis\b/u', $t)) return true;
	return (bool)(preg_match('/\bdelayed\b/u', $t) && preg_match('/\b(?:measles|mr|mcv)\b/u', $t));
}
/* Item label, e.g. "9.1.2 BCG" for "9.1.2. :: Child immunisation - BCG" (keyMissing.ts m9ItemLabel). */
function dqa_m9_item_label($text){
	$text = trim((string)$text);
	$code = '';
	if(preg_match('/^\s*([0-9]+(?:\.[0-9]+)+(?:\.[a-z])?)\.?\s*(?::{1,2}|-|—)?\s*/iu', $text, $m)){
		$code = $m[1];
		$text = (string)substr($text, strlen($m[0]));
	}
	$name = trim((string)preg_replace('/\s+/u', ' ', $text));
	$short = preg_replace('/^child immuni[sz]ation\s*(?:\([^)]*\))?\s*-\s*/iu', '', $name);
	if($short !== null) $name = $short;
	return ($code !== '') ? $code.' '.$name : $name;
}
/* Month-on-month change, or null when the pair cannot be judged (checkRules.ts
   monthOnMonthChange): 'small' = both values under 10 (doubled increase bands, no
   decrease bands); a rise from 0 is 'fromZero' unless both values are under 10. */
function dqa_mom_change($prev, $curr){
	if($prev === null || $curr === null || $prev < 0) return null;
	$small = (max($prev, $curr) < 10);
	if($prev == 0) return $small ? null : array('pct'=>null, 'fromZero'=>true, 'small'=>false);
	return array('pct'=>round(($curr - $prev) / $prev * 100, 9), 'fromZero'=>false, 'small'=>$small);
}
/* Outlier band of a change (checkRules.ts outlierBand). Increase: Low 25 to <50,
   Moderate 50-100, Extreme >100 or from 0 (all doubled when both values are under 10);
   decrease: Low -25 to >-50, Moderate -50 to >-75, Extreme -75 to -100 (none when both
   values are under 10). */
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
/* Dropout % from an earlier to a later dose; null unless the earlier dose is above 0
   (checkRules.ts dropoutPct). */
function dqa_dropout_pct($from, $to){
	if($from === null || $to === null || $from <= 0) return null;
	return round(($from - $to) / $from * 100, 9);
}
/* Dropout range: R5_10 = 5 to <10, R11_20 = 10 to <20, R20P = 20 or more
   (checkRules.ts dropoutRange; the ids are kept from the old ranges). */
function dqa_dropout_range($pct){
	if($pct === null) return null;
	if($pct >= 20) return 'R20P';
	if($pct >= 10) return 'R11_20';
	if($pct >= 5) return 'R5_10';
	return null;
}
/* Later dose above an earlier dose: flagged beyond +25% (+50% when both are under 10);
   from an earlier dose of 0 only when the later one is 10 or more; null = not comparable
   (checkRules.ts laterDoseExceeds). */
function dqa_later_dose_exceeds($earlier, $later){
	if($earlier === null || $later === null) return null;
	if($earlier <= 0) return ($later >= 10);
	$allowed = (max($earlier, $later) < 10) ? 50 : 25;
	return ($later - $earlier) * 100 > $allowed * $earlier;
}
/* "+33.3%" (or "from 0") for a later dose against the earlier one (checkRules.ts doseExcessLabel). */
function dqa_dose_excess_label($earlier, $later){
	if($earlier <= 0) return 'from 0';
	$pct = ($later - $earlier) / $earlier * 100;
	return ($pct > 0 ? '+' : '').number_format($pct, 1, '.', '').'%';
}
/* Co-administration: the vaccines of a group whose value is out of range in one month
   (coadmin.ts coadminAssess). Fewer than 2 reported values = not checkable. Reference:
   the value repeated most often (one clear winner), else Penta's value, else MR's value,
   else the median. Out of range: more than 25% from the reference (50% when the reference
   is under 10); with a reference of 0, a value of 10 or more. Blanks are never compared.
   $vals = array(vaccine => value|null) in group order; returns array(vaccine => true). */
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
/* "All months" totals of a co-administration row: summed only over the months in which
   every vaccine this facility reported at all is present (coadmin.ts coadminMatchedTotals). */
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
/* Outliers (computeKpis.ts t3): calendar-adjacent month pairs ($pairList), a pair with an
   all-zero month ($t0Hit) skipped, a facility flagged when a selected band ($bands) is hit.
   $vaxCols = array(vaccine => column); $onHit($md, $ci) records highlighted cells (optional).
   Eligible = at least one vaccine x pair could be compared. */
function dqa_eval_outliers($facFiltered, $vaxCols, $pairList, $t0Hit, $bands, $onHit = null){
	$res = array('flagged'=>array(), 'eligible'=>array(), 'any'=>array(), 'all'=>array(), 'rows'=>array(), 'hitMap'=>array(),
		'vxAny'=>array_fill_keys(array_keys($vaxCols), 0), 'vxAll'=>array_fill_keys(array_keys($vaxCols), 0));
	foreach($facFiltered as $key=>$fd){
		$evalPairs = array(); $hitPairs = array(); $cells = array();
		foreach($vaxCols as $vx=>$ci){
			$vxEval = 0; $vxHits = 0;
			foreach($pairList as $p){
				if(isset($t0Hit[$key][$p['m1']]) || isset($t0Hit[$key][$p['m2']])) continue;
				$md1 = isset($fd['months'][$p['m1']]) ? $fd['months'][$p['m1']] : null;
				$md2 = isset($fd['months'][$p['m2']]) ? $fd['months'][$p['m2']] : null;
				$v1 = ($md1 && isset($md1['vals'][$ci])) ? $md1['vals'][$ci] : null;
				$v2 = ($md2 && isset($md2['vals'][$ci])) ? $md2['vals'][$ci] : null;
				$ch = dqa_mom_change($v1, $v2);
				if($ch === null) continue;
				$evalPairs[$p['k']] = true;
				$vxEval++;
				$band = dqa_outlier_band($ch);
				if($band === null || !isset($bands[$band])) continue;
				$vxHits++;
				$hitPairs[$p['k']] = true;
				$res['hitMap'][$key][$p['m1']][$vx] = true;
				$res['hitMap'][$key][$p['m2']][$vx] = true;
				$cells[$vx][$p['k']] = array('a'=>$v1, 'b'=>$v2, 'pct'=>$ch['pct'], 'fromZero'=>$ch['fromZero'], 'hit'=>true);
				if($onHit){ $onHit($md1, $ci); $onHit($md2, $ci); }
			}
			if($vxHits > 0) $res['vxAny'][$vx]++;
			if($vxEval > 0 && $vxHits === $vxEval) $res['vxAll'][$vx]++;
		}
		if(!empty($evalPairs)) $res['eligible'][$key] = true;
		if(!empty($hitPairs)){
			$res['flagged'][$key] = true;
			if(count($hitPairs) === count($evalPairs)) $res['all'][$key] = true; else $res['any'][$key] = true;
			$res['rows'][$key] = array('block'=>display_block_label($fd['block']), 'facility'=>$fd['facility'], 'cells'=>$cells);
		}
	}
	return $res;
}
/* Dropouts (computeKpis.ts): judged on the period dropout over the months in which both
   doses are reported; eligible when that % can be computed (earlier total above 0).
   Monthly values are kept for the table; "All months" = every month with a computable
   monthly % is in range. $onHit($md) records the highlighted cells (optional). */
function dqa_eval_dropouts($facFiltered, $months, $iFrom, $iTo, $ranges, $onHit = null){
	$res = array('flagged'=>array(), 'eligible'=>array(), 'any'=>array(), 'all'=>array(), 'rows'=>array(), 'hitSet'=>array());
	foreach($facFiltered as $fkey=>$fd){
		$sumA = 0; $sumB = 0; $mds = array(); $matched = array(); $cells = array(); $mEval = 0; $mHit = 0;
		foreach($months as $mk){
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$A = ($md && isset($md['vals'][$iFrom])) ? $md['vals'][$iFrom] : null;
			$B = ($md && isset($md['vals'][$iTo])) ? $md['vals'][$iTo] : null;
			$cells[$mk] = array('from'=>null, 'to'=>null, 'pct'=>null);
			if($A === null || $B === null) continue;
			$sumA += $A; $sumB += $B; $mds[] = $md; $matched[$mk] = true;
			$mp = dqa_dropout_pct($A, $B);
			$cells[$mk] = array('from'=>$A, 'to'=>$B, 'pct'=>$mp);
			if($mp !== null){
				$mEval++;
				$r = dqa_dropout_range($mp);
				if($r !== null && isset($ranges[$r])) $mHit++;
			}
		}
		$pp = dqa_dropout_pct($sumA, $sumB);
		if($pp === null) continue;
		$res['eligible'][$fkey] = true;
		$r = dqa_dropout_range($pp);
		if($r === null || !isset($ranges[$r])) continue;
		$res['flagged'][$fkey] = true;
		if($mEval > 0 && $mHit === $mEval) $res['all'][$fkey] = true; else $res['any'][$fkey] = true;
		$res['hitSet'][$fkey] = $matched;
		$res['rows'][$fkey] = array('block'=>display_block_label($fd['block']), 'facility'=>$fd['facility'], 'cells'=>$cells,
			'all'=>array('from'=>$sumA, 'to'=>$sumB, 'pct'=>$pp));
		if($onHit){ foreach($mds as $md) $onHit($md); }
	}
	return $res;
}
/* Check weights of the Overall Score, % of the overall (weightedScoring.ts CHECK_WEIGHTS.HMIS).
   1 month selected: Availability 20 (t1, t0, t10), Completeness 30 (t2), Consistency 25
   (Sessions Held > Planned, Penta3>Penta1, MR2>MR1) + 25 (5 co-administration groups);
   Accuracy is not scored. 2 or more months: Availability 20 (+ t7), Completeness 30,
   Accuracy 12.5 (Outliers) + 12.5 (3 dropouts), Consistency 12.5 + 12.5. A group's
   weight is split equally between its checks. */
function dqa_weight_table($periodCount){
	$t = array();
	$add = function($comp, $grp, $w, $checks) use (&$t){
		foreach($checks as $id=>$label){ $t[] = array('id'=>$id, 'name'=>$label, 'comp'=>$comp, 'grp'=>$grp, 'w'=>$w / count($checks)); }
	};
	$avail = array('t1'=>'All Indicators Blank', 't0'=>'Indicators having 0 values but not blank', 't10'=>'Session Not Held but Vaccinated');
	$incons = array('t6'=>'Sessions Held > Sessions Planned', 'i1'=>'Inconsistencies — Penta3>Penta1', 'i2'=>'Inconsistencies — MR2>MR1');
	$co = array('co1'=>'Co-administration — 6 weeks', 'co2'=>'Co-administration — 10 weeks', 'co3'=>'Co-administration — 14 weeks', 'co4'=>'Co-administration — 9 months', 'co5'=>'Co-administration — 2 years');
	if($periodCount >= 2){
		$avail['t7'] = 'Duplicate Monthly Record';
		$add('availability', 'all', 20, $avail);
		$add('completeness', 'all', 30, array('t2'=>'Key Missing Indicators'));
		$add('accuracy', 'outliers', 12.5, array('t3'=>'Outliers'));
		$add('accuracy', 'dropouts', 12.5, array('drop_penta1_penta3'=>'Dropouts — Penta1→Penta3', 'drop_mr1_mr2'=>'Dropouts — MR1→MR2', 'drop_penta3_mr1'=>'Dropouts — Penta3→MR1'));
		$add('consistency', 'incons', 12.5, $incons);
		$add('consistency', 'coadmin', 12.5, $co);
	} else {
		$add('availability', 'all', 20, $avail);
		$add('completeness', 'all', 30, array('t2'=>'Key Missing Indicators'));
		$add('consistency', 'incons', 25, $incons);
		$add('consistency', 'coadmin', 25, $co);
	}
	return $t;
}
/* Weighted Overall Score (weightedScoring.ts scoreWeighted). $cards = array(id =>
   array('flagged'=>n, 'eligible'=>n, 'name'=>text)) from the standard checks; $den =
   facilities under the selection; $periodCount = selected months. Check score =
   max(0, 100 - flagged / den x 100); a check with no eligible facility cannot run and
   its weight passes on in proportion: to its group, then its component, then the other
   components. Component = weighted average of its checks (null = N/A); overall = sum of
   weight used x check score / 100 (null when nothing can be scored). */
function dqa_weighted_score($cards, $den, $periodCount){
	$rows = dqa_weight_table($periodCount);
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
	foreach(array('availability', 'completeness', 'accuracy', 'consistency') as $comp){
		$comps[$comp] = !empty($cW[$comp]) ? round($cP[$comp] * 100 / $cW[$comp], 9) : null;
		$compWeights[$comp] = !empty($cW[$comp]) ? $cW[$comp] : 0;
	}
	return array('overall'=>($tRun > 0 ? round($overall, 9) : null), 'components'=>$comps, 'componentWeights'=>$compWeights, 'checks'=>$rows, 'periodCount'=>(int)$periodCount);
}

/* --------- Simple HTML .XLS output with CELL-LEVEL highlight styles ---------
   $style_map: [rowIndex => [colIndex => true|string(color)]] */
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
				if(is_array($v)){ /* (added) array('color'=>..,'bold'=>true) */
					$color = isset($v['color']) ? (string)$v['color'] : "#ffc0cb";
					$style = "background:".$color.";".(!empty($v['bold']) ? "font-weight:bold;" : "");
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
	$idxDist = isset($_SESSION['idxDist']) ? $_SESSION['idxDist'] : null;
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
	   download only applies that map to the full uploaded file. So the file always
	   matches the card and table (same months, same filters, same rule), including
	   cells holding text such as "NA", the 10 weeks group and FIC-Total. */
	$full = [];
	$full[] = $header;
	foreach($rows as $r){
		if(count($r)<count($header)) $r=array_pad($r,count($header),'');
		$full[] = $r;
	}
	$style_map = [];

	/* Also highlight District/Block/Facility/Month cells for any flagged row */
	$metaCols = [];
	foreach([$idxDist,$idxBlock,$idxFac,$idxMonth] as $mc){ if($mc!==null) $metaCols[(int)$mc]=true; }

	$dqa_hl_all = (isset($_SESSION['dqa_hl']) && is_array($_SESSION['dqa_hl'])) ? $_SESSION['dqa_hl'] : array();
	$dqa_hl_key = (isset($dqa_hl_all[$key]) && is_array($dqa_hl_all[$key])) ? $dqa_hl_all[$key] : array();
	$dqa_ncols = count($header);
	foreach($dqa_hl_key as $dqa_src=>$dqa_cells){
		$ri = (int)$dqa_src + 1; /* +1: row 0 of $full is the header */
		if($ri < 1 || $ri >= count($full)) continue;
		$dqa_toks = explode(',', (string)$dqa_cells);
		if(in_array('-1', $dqa_toks, true)){ /* whole row (Availability KPIs) */
			for($ci=0;$ci<$dqa_ncols;$ci++){ $style_map[$ri][$ci]=true; }
			continue;
		}
		foreach($dqa_toks as $dqa_tok){
			if($dqa_tok==='' || !is_numeric($dqa_tok)) continue;
			$ci = (int)$dqa_tok;
			if($ci < 0 || $ci >= $dqa_ncols) continue;
			$style_map[$ri][$ci] = true;
		}
		foreach($metaCols as $ci=>$on){ if(!isset($style_map[$ri][$ci])) $style_map[$ri][$ci]=true; }
	}

	header("Content-Type: application/vnd.ms-excel; charset=utf-8");
	header('Content-Disposition: attachment; filename="'.$label.'.xls"');
	output_xls_html_cells($full, $style_map);
	exit;
}

/* -------------------- Upload / Apply Filters flow -------------------- */
$action = isset($_POST['action']) ? $_POST['action'] : null;

if($action==='download_word_overall'){
	// Word export for Overall Score (HTML-based .doc with embedded chart images).
	$osHtml = isset($_POST['os_word_html']) ? (string)$_POST['os_word_html'] : '';
	if(trim($osHtml)===''){ render_page("Nothing to export."); exit; }

	header("Content-Type: application/msword; charset=utf-8");
	header('Content-Disposition: attachment; filename="Overall_Summary.doc"');

	echo "\xEF\xBB\xBF"; // UTF-8 BOM helps MS Word open the file correctly
	echo "<html xmlns:v=\"urn:schemas-microsoft-com:vml\" ".
		"xmlns:o=\"urn:schemas-microsoft-com:office:office\" ".
		"xmlns:w=\"urn:schemas-microsoft-com:office:word\" ".
		"xmlns:m=\"http://schemas.microsoft.com/office/2004/12/omml\" ".
		"xmlns=\"http://www.w3.org/TR/REC-html40\">";
	echo "<head>";
	echo "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">";
	echo "<meta charset=\"utf-8\">";
	echo "<title>Overall Score</title>";
	echo "<style>
<!--@page
	{size: A4 landscape; margin:1cm;}
#OSOVERLAY
	{inset:auto !important;
	position:static;}
.OSTOPBAR
	{position:static;}
.OSWRAP
	{max-width:100% !important;}
button{display:none !important;}
img
	{max-width:100%;height:auto;}
.osBarImg
	{width:660pt !important;max-width:660pt !important;height:auto !important;}
canvas{display:none !important;}
.BOX
	{border-radius:12px;}
.DOT
	{display:inline-block;
	border-radius:50%;}
.IMGBOX
	{border-radius:12px;}

 /* Font Definitions */
 @font-face
	{font-family:\"Cambria Math\";
	panose-1:2 4 5 3 5 4 6 3 2 4;
	mso-font-charset:0;
	mso-generic-font-family:roman;
	mso-font-pitch:variable;
	mso-font-signature:-536869121 1107305727 33554432 0 415 0;}
@font-face
	{font-family:Calibri;
	panose-1:2 15 5 2 2 2 4 3 2 4;
	mso-font-charset:0;
	mso-generic-font-family:swiss;
	mso-font-pitch:variable;
	mso-font-signature:-469750017 -1040178053 9 0 511 0;}
 /* Style Definitions */
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{mso-style-unhide:no;
	mso-style-qformat:yes;
	mso-style-parent:\"\";
	margin:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.msonormal0, li.msonormal0, div.msonormal0
	{mso-style-name:msonormal;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.oswtitle, li.oswtitle, div.oswtitle
	{mso-style-name:oswtitle;
	mso-style-unhide:no;
	margin-top:0cm;
	margin-right:0cm;
	margin-bottom:4.0pt;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:20.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	font-weight:bold;}
p.oswmeta, li.oswmeta, div.oswmeta
	{mso-style-name:oswmeta;
	mso-style-unhide:no;
	margin-top:0cm;
	margin-right:0cm;
	margin-bottom:12.0pt;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	color:#334155;
	font-weight:bold;}
p.box, li.box, div.box
	{mso-style-name:box;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	border:none;
	mso-border-alt:solid #CBD5E1 .75pt;
	padding:0cm;
	mso-padding-alt:10.0pt 10.0pt 10.0pt 10.0pt;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.muted, li.muted, div.muted
	{mso-style-name:muted;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	color:#475569;
	font-weight:bold;}
p.k, li.k, div.k
	{mso-style-name:k;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:20.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	font-weight:bold;}
p.sm, li.sm, div.sm
	{mso-style-name:sm;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:11.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	color:#475569;
	font-weight:bold;}
p.tbl, li.tbl, div.tbl
	{mso-style-name:tbl;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.sechead, li.sechead, div.sechead
	{mso-style-name:sechead;
	mso-style-unhide:no;
	margin-top:14.0pt;
	margin-right:0cm;
	margin-bottom:6.0pt;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:16.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	font-weight:bold;}
p.secsub, li.secsub, div.secsub
	{mso-style-name:secsub;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:6.0pt;
	mso-pagination:widow-orphan;
	font-size:11.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	color:#64748B;
	font-weight:bold;}
p.impactrow, li.impactrow, div.impactrow
	{mso-style-name:impactrow;
	mso-style-unhide:no;
	margin-top:8.0pt;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.dot, li.dot, div.dot
	{mso-style-name:dot;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:6.0pt;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.dotany, li.dotany, div.dotany
	{mso-style-name:dotany;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	background:#2563EB;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.dotall, li.dotall, div.dotall
	{mso-style-name:dotall;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	background:#0F766E;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
p.impactval, li.impactval, div.impactval
	{mso-style-name:impactval;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:6.0pt;
	mso-pagination:widow-orphan;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;
	font-weight:bold;}
p.imgbox, li.imgbox, div.imgbox
	{mso-style-name:imgbox;
	mso-style-unhide:no;
	mso-margin-top-alt:auto;
	margin-right:0cm;
	mso-margin-bottom-alt:auto;
	margin-left:0cm;
	mso-pagination:widow-orphan;
	border:none;
	mso-border-alt:solid #CBD5E1 .75pt;
	padding:0cm;
	mso-padding-alt:8.0pt 8.0pt 8.0pt 8.0pt;
	font-size:12.0pt;
	font-family:\"Times New Roman\",serif;
	mso-fareast-font-family:\"Times New Roman\";
	mso-fareast-theme-font:minor-fareast;}
span.secsub1
	{mso-style-name:secsub1;
	mso-style-unhide:no;
	mso-ansi-font-size:11.0pt;
	mso-bidi-font-size:11.0pt;
	color:#64748B;
	font-weight:bold;}
span.dot1
	{mso-style-name:dot1;
	mso-style-unhide:no;}
span.impactval1
	{mso-style-name:impactval1;
	mso-style-unhide:no;
	mso-ansi-font-size:12.0pt;
	mso-bidi-font-size:12.0pt;
	font-weight:bold;}
.MsoChpDefault
	{mso-style-type:export-only;
	mso-default-props:yes;
	font-size:10.0pt;
	mso-ansi-font-size:10.0pt;
	mso-bidi-font-size:10.0pt;
	mso-font-kerning:0pt;
	mso-ligatures:none;}
@page WordSection1
	{size:595.3pt 841.9pt;
	margin:72.0pt 72.0pt 72.0pt 72.0pt;
	mso-header-margin:35.4pt;
	mso-footer-margin:35.4pt;
	mso-paper-source:0;}
div.WordSection1
	{page:WordSection1;}
-->


#osOverlay{inset:auto !important; position:static !important; display:block !important;}
.osTopbar{position:static !important;}
.osWrap{max-width:100% !important;}
.box{border-radius:12px;}
.dot{display:inline-block; border-radius:50%;}
.imgbox{border-radius:12px;}
</style>";
	echo "</head>";
	echo "<body lang=\"EN-IN\" style=\"tab-interval:36.0pt;word-wrap:break-word\">";
	echo $osHtml;
	echo "</body></html>";
	exit;
}

if($action==='upload' && isset($_FILES['csv'])){
	$file = $_FILES['csv'];
	if($file['error']!==UPLOAD_ERR_OK){ render_page("Upload failed: error code ".$file['error']); exit; }
	$csvPath = $file['tmp_name'];
	$origName = $file['name'];
	/* (added) .xlsx support: an Excel workbook is read into the same row arrays
	   that a .csv file gives, then everything below is processed identically. */
	$dqa_is_xlsx = dqa_upload_is_xlsx($csvPath, $origName);
	$dqa_xlsx_rows = null;
	if($dqa_is_xlsx){
		$dqa_xlsx_err = '';
		$dqa_xlsx_rows = dqa_xlsx_read_rows($csvPath, $dqa_xlsx_err);
		if($dqa_xlsx_rows === null){ render_page($dqa_xlsx_err); exit; }
	} else {
	$fh = fopen($csvPath,'r');
	if(!$fh){ render_page("Cannot open uploaded file."); exit; }
	} /* (added) end of .xlsx / .csv branch */

	/* ---- Read all raw lines from file, then normalise header before processing ----
	   Handles two HMIS CSV formats:
	   FORMAT A (proper):   Row 1 = full column headers, Row 2+ = data.
	   FORMAT B (improper): Rows 1-2 = report title/metadata preamble, Row 3 = partial
	                        header (facility meta cols only, indicator cols replaced by
	                        section group labels like "M9 [CHILD IMMUNISATION]"),
	                        Row 4 = second header row (indicator names in cols 34+,
	                        cols 0-33 blank), Row 5 = blank, Row 6+ = data.
	   Detection: if the first row that looks like a header row is missing the
	   indicator names (cols after Month are blank or group-label only), we look ahead
	   for a second header row that supplies the indicator names and merge the two.
	   Any leading preamble rows (no "Month" column found) and any blank rows
	   immediately after the merged header are skipped transparently.
	   Everything downstream (norm, idxBlock, idxFac, etc.) is unchanged. */

	/* Helper: check if a parsed CSV row is completely blank */
	$row_is_blank = function($r){
		foreach($r as $v){ if(trim((string)$v) !== '') return false; }
		return true;
	};

	/* Helper: check if a parsed row looks like a proper header row
	   (contains at least one of the required field names) */
	$row_has_meta_headers = function($r){
		$required = ['block name','facility name','month','health block name',
		             'facility_name','session site name'];
		foreach($r as $v){
			$low = strtolower(trim((string)$v));
			foreach($required as $req){ if($low === $req) return true; }
			/* (added) tolerant match for slightly changed column names */
			$cmp = dqa_header_compact($v);
			if($cmp !== ''){ foreach($required as $req){ if($cmp === dqa_header_compact($req)) return true; } }
		}
		return false;
	};

	/* Read all rows from the file into memory */
	$allRawRows = [];
	if($dqa_is_xlsx){ $allRawRows = $dqa_xlsx_rows; unset($dqa_xlsx_rows); } else { /* (added) .xlsx rows were read above */
	while(($r = fgetcsv($fh)) !== false){
		$allRawRows[] = $r;
	}
	fclose($fh);
	} /* (added) end of .xlsx / .csv branch */

	if(empty($allRawRows)){ render_page("Empty file or unreadable header."); exit; }

	/* Step 1: Skip leading preamble rows until we find a row with meta headers */
	$startIdx = null;
	foreach($allRawRows as $i => $r){
		if($row_has_meta_headers($r)){
			$startIdx = $i;
			break;
		}
	}
	if($startIdx === null){ render_page("Empty file or unreadable header."); exit; }

	$headerRowA = $allRawRows[$startIdx]; // first header row found

	/* Step 2: Detect FORMAT B — check if indicator columns (after col 33) are
	   all blank or contain only section group labels (no HMIS code like "9.1.2").
	   A group label looks like "M9 [...]" and does NOT contain a dot-number code. */
	$colCount = count($headerRowA);
	/* (added) column positions can change: the scan also starts right after the
	   Month column when Month sits before the original fixed position (34). */
	$dqa_scan_from = 34;
	foreach($headerRowA as $dqa_ci => $dqa_hv){
		if(in_array(dqa_header_compact($dqa_hv), array('month','reportingmonth','monthname'), true)){
			if($dqa_ci + 1 < $dqa_scan_from) $dqa_scan_from = $dqa_ci + 1;
			break;
		}
	}
	$indicatorColsEmpty = true;
	if($colCount > $dqa_scan_from){ /* (changed) was: $colCount > 34 */
		for($ci = $dqa_scan_from; $ci < $colCount; $ci++){ /* (changed) was: $ci = 34 */
			$v = trim((string)(isset($headerRowA[$ci]) ? $headerRowA[$ci] : ''));
			if($v !== '' && preg_match('/\d+\.\d+/', $v)){
				/* Found a real indicator code — this is already a proper header */
				$indicatorColsEmpty = false;
				break;
			}
		}
	} else {
		$indicatorColsEmpty = false; // very few cols, treat as proper
	}

	if($indicatorColsEmpty){
		/* FORMAT B: look for the second header row immediately after (skip blanks) */
		$headerRowB = null;
		for($j = $startIdx + 1; $j < count($allRawRows); $j++){
			if($row_is_blank($allRawRows[$j])) continue;
			/* Check if this row has indicator codes in the expected positions */
			$rj = $allRawRows[$j];
			$hasIndicator = false;
			foreach($rj as $v){
				if(preg_match('/^\s*\d+\.\d+/', trim((string)$v))){ $hasIndicator = true; break; }
			}
			if($hasIndicator){
				$headerRowB = $rj;
				$startIdx = $j; // data starts after this row
				break;
			} else {
				/* Not a blank and not an indicator row — stop looking */
				break;
			}
		}

		/* Merge: take headerRowA for cols 0-33, headerRowB for cols 34+ */
		$mergedHeader = $headerRowA;
		if($headerRowB !== null){
			$lenB = count($headerRowB);
			for($ci = 0; $ci < $lenB; $ci++){
				$vb = trim((string)(isset($headerRowB[$ci]) ? $headerRowB[$ci] : ''));
				if($vb !== ''){
					/* Only take from row B if row A's cell is blank or a group label
					   (group labels never contain a dot-number code) */
					$va = trim((string)(isset($mergedHeader[$ci]) ? $mergedHeader[$ci] : ''));
					if($va === '' || !preg_match('/\d+\.\d+/', $va)){
						$mergedHeader[$ci] = $headerRowB[$ci];
					}
				}
			}
		}
		$rawHeader = $mergedHeader;
	} else {
		/* FORMAT A: proper header — use as-is */
		$rawHeader = $headerRowA;
	}

	/* Step 3: Collect data rows — everything after the header row(s).
	   Skip any blank rows that come immediately after the header. */
	$dataStartIdx = $startIdx + 1;
	while($dataStartIdx < count($allRawRows) && $row_is_blank($allRawRows[$dataStartIdx])){
		$dataStartIdx++;
	}
	$allDataRows = array_slice($allRawRows, $dataStartIdx);
	$dqa_scan_pre = array_slice($allRawRows, 0, min($dataStartIdx, 20)); /* (added) preamble+header rows kept for the DQA launcher State check below */
	unset($allRawRows); /* free raw buffer; not needed after slicing (large-file memory) */
	/* ---- End of header normalisation ---- */

	if(empty($rawHeader)){ render_page("Empty file or unreadable header."); exit; }

	$header = [];
	foreach($rawHeader as $hcell){ $header[] = strip_bom(trim((string)$hcell)); }
	$norm = [];
	foreach($header as $hcell){ $norm[] = normalize_header($hcell); }

	$idxBlock = array_search_first($norm,['block name','health block name','lgd block name','block','block_name']);
	$idxFac   = array_search_first($norm,['facility name','health facility name','facility','facility_name','session site name','session site','session_site_name']);
	$idxMonth = array_search_first($norm,['month','reporting month','month name']);
	$idxOwner = array_search_first($norm,['ownership','ownership status']);
	$idxRU    = array_search_first($norm,['rural/urban','rural urban','rural-urban','rural - urban','ruralurban','rural','urban']);
	$idxState = array_search_first($norm,['state','state name','state_name']);
	$idxDist  = array_search_first($norm,['district','district name','district_name']);

	if($idxBlock===null || $idxFac===null || $idxMonth===null){
		render_page("Please upload a .csv or .xlsx file with required headers: Block Name, Facility Name (or Session Site Name), Month.");
		exit;
	}

	$rows=[];
	foreach($allDataRows as $r){
		if(count($r)<count($header)) $r=array_pad($r,count($header),'');
		$rows[]=$r;
	}
	unset($allDataRows); /* free intermediate buffer (large-file memory) */

	/* ==================================================================
	   (added) DQA Launcher State verification + District override
	   ------------------------------------------------------------------
	   dqa.php saved the id of the usage-log record and the State selected
	   on the launcher form in this same session (dqa_log_id / dqa_log_state).
	   Requirement:
	     - The uploaded file must belong to the SAME State as selected.
	     - Mismatch  -> alert the user, DELETE that usage-log record (so only
	                    matching-State records are kept) and return the user
	                    to the dqa.php launcher. The upload is not processed.
	     - Match     -> keep the record and OVERRIDE its 'district' column
	                    with the District found in the uploaded file.
	   State/District are looked up first in their own columns of the file
	   (already located above as $idxState / $idxDist); if the State column
	   is absent or empty, the report preamble/header and the first data
	   rows are scanned for the selected State name (State can appear
	   anywhere in the file). If no District can be found in the file, the
	   District recorded from the launcher form is left unchanged.
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

		/* 1) State / District from their own columns (first non-empty value). */
		$dqa_file_state = '';
		$dqa_file_dist  = '';
		if ($idxState !== null) {
			foreach ($rows as $r) {
				$v = trim((string)(isset($r[$idxState]) ? $r[$idxState] : ''));
				if ($v !== '') { $dqa_file_state = $v; break; }
			}
		}
		if ($idxDist !== null) {
			foreach ($rows as $r) {
				$v = trim((string)(isset($r[$idxDist]) ? $r[$idxDist] : ''));
				if ($v !== '') { $dqa_file_dist = $v; break; }
			}
		}

		/* 2) Fallback: the State may appear anywhere in the file (report
		      preamble, header row, or inside cells). Scan the preamble +
		      header rows and the first data rows for the selected State. */
		if ($dqa_file_state === '') {
			$dqa_needle = $dqa_norm($dqa_sel_state);
			$dqa_scan = array_merge(
				isset($dqa_scan_pre) && is_array($dqa_scan_pre) ? $dqa_scan_pre : array(),
				array($header),
				array_slice($rows, 0, 50)
			);
			foreach ($dqa_scan as $r) {
				if (!is_array($r)) continue;
				foreach ($r as $cell) {
					if ($dqa_needle !== '' && strpos($dqa_norm($cell), $dqa_needle) !== false) {
						$dqa_file_state = $dqa_sel_state; /* selected State found inside the file */
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
			/* Mismatch (or State not found in the file): delete the usage-log
			   record so only matching-State records remain, then alert the
			   user and return them to the launcher. Upload is NOT processed. */
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
				? 'The State could not be found in the uploaded file, so it cannot be verified against the State selected on the DQA Tools page (' . $dqa_sel_state . '). Please select the correct State on the DQA Tools page and upload the matching file.'
				: 'State mismatch: the uploaded file belongs to "' . $dqa_file_state . '", but "' . $dqa_sel_state . '" was selected on the DQA Tools page. Please select the correct State and upload the matching file.';
			echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>State mismatch</title></head><body>'
			   . '<script>alert(' . json_encode($dqa_msg) . '); window.location.replace("https://www.datamgmt.in/dqa.php");</script>'
			   . '<noscript><p>' . h($dqa_msg) . '</p><p><a href="https://www.datamgmt.in/dqa.php">Return to DQA Tools page</a></p></noscript>'
			   . '</body></html>';
			exit;
		}

		/* Match: override the record's District with the District found in
		   the uploaded file (only when found). Best-effort and silent - the
		   analysis flow below continues exactly as before. */
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

	if($STORE_TO_DB){
		$db = db_connect($GLOBALS['DB_HOST'],$GLOBALS['DB_USER'],$GLOBALS['DB_PASS'],$GLOBALS['DB_NAME']);
		db_bootstrap($db);
		if($db){
			$stmt=$db->prepare("INSERT INTO csv_uploads(filename,num_rows,header_json) VALUES(?,?,?)");
			if($stmt){
				$num_rows=count($rows);
				$hjson=json_encode($header,JSON_UNESCAPED_UNICODE);
				$stmt->bind_param('sis',$origName,$num_rows,$hjson);
				$stmt->execute();
				$stmt->close();
			}
			$db->close();
		}
	}

	$_SESSION['csv_header']=$header;
	$_SESSION['csv_norm']=$norm;
	$_SESSION['csv_rows']=$rows;
	$_SESSION['idxBlock']=$idxBlock;
	$_SESSION['idxFac']=$idxFac;
	$_SESSION['idxMonth']=$idxMonth;
	$_SESSION['idxOwner']=$idxOwner;
	$_SESSION['idxRU']=$idxRU;
	$_SESSION['idxState']=$idxState;
	$_SESSION['idxDist']=$idxDist;
	$_SESSION['file_name']=$origName;
	/* (added) identity of this upload: pages and downloads built from it carry the id,
	   so data replaced later by another upload in this browser is detected */
	$_SESSION['dqa_upload_id'] = dqa_new_upload_id();
	$_SESSION['dqa_upload_tool'] = 'dqahmis';
	$_SESSION['dqa_upload_sig'] = dqa_data_sig();
	$_SESSION['dqa_hl'] = [];

	/* Default filters */
	$_SESSION['filters'] = [
		'blocks'=>[],
		'months'=>[],
		'ownership'=>[],
		'ru'=>[],
		'outliers_vax'=>['BCG','Penta1','Penta3','MR1','MR2'], /* (changed 2026-10, web parity) standard outlier vaccines: OPV1 / OPV3 left out */
		'add_vax'=>[],
		'outliers_inc'=>['INC_EXT'],
		'outliers_drop'=>['DROP_EXT'],
		/* default ONLY >=20% */
		'drop_ranges'=>['R20P'],
		'drop_pairs'=>['Penta1→Penta3','MR1→MR2','Penta3→MR1'], /* (changed 2026-10, web parity) the 3 standard pairs; BCG→MR1 is an optional tick */
		/* pair builder rows (index-wise) */
		'drop_from'=>[],
		'drop_to'=>[],
		/* NEW: inconsistencies pair builder rows (index-wise) */
		'incons_from'=>[],
		'incons_to'=>[],
		'active_group' => '',
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
		/* persist exactly if missing */
		'outliers_inc' => $keep_prev_array_if_missing('outliers_inc','outliers_inc'),
		'outliers_drop' => $keep_prev_array_if_missing('outliers_drop','outliers_drop'),
		'drop_ranges' => isset($_POST['drop_ranges']) ? (array)$_POST['drop_ranges'] : [],
		'drop_pairs' => isset($_POST['drop_pairs']) ? (array)$_POST['drop_pairs'] : [],
		/* pair builder rows (index-wise) */
		'drop_from' => $clean_nonempty(isset($_POST['drop_from']) ? (array)$_POST['drop_from'] : []),
		'drop_to' => $clean_nonempty(isset($_POST['drop_to']) ? (array)$_POST['drop_to'] : []),
		/* NEW: inconsistencies pair builder rows (index-wise) */
		'incons_from' => $clean_nonempty(isset($_POST['incons_from']) ? (array)$_POST['incons_from'] : []),
		'incons_to' => $clean_nonempty(isset($_POST['incons_to']) ? (array)$_POST['incons_to'] : []),
		'active_group' => isset($_POST['active_group']) ? (string)$_POST['active_group'] : (isset($prev['active_group']) ? (string)$prev['active_group'] : ''),
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
		:root{ --text:#0b1220; --muted:#475569; }
		*{box-sizing:border-box}
		body{
			margin:0;min-height:100vh;color:var(--text);
			font:15px/1.5 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
			background:#0ea5e9 linear-gradient(135deg,#0ea5e9 0%, #22d3ee 100%) fixed;
		}
		.container{max-width:980px;margin:0 auto;padding:40px 18px}
		.header{display:flex;gap:16px;align-items:center;justify-content:center;margin-top:18px}
		.logo{width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#22d3ee,#6366f1);
			box-shadow:0 14px 34px rgba(34,211,238,.35);display:grid;place-items:center;color:#fff;font-weight:900;font-size:20px}
		.title{text-align:center}
		.title h1{margin:8px 0 4px;font-size:30px;font-weight:900;letter-spacing:.2px;color:#fff}
		.title p{margin:0;color:#f0f9ff;font-weight:600}
		.card{margin:28px auto 0;border-radius:22px;padding:0;background:rgba(255,255,255,.9);
			box-shadow:0 16px 40px rgba(2,6,23,.35);overflow:hidden;border:1px solid rgba(255,255,255,.8)}
		.cardHeader{background:linear-gradient(90deg,#22d3ee,#6366f1);padding:14px}
		.cardHeader h3{margin:0;color:#fff;font-weight:900}
		.cardInner{padding:20px}
		.formRow{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
		label{font-weight:800;color:#0f172a}
		input[type=file]{
			background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;width:100%;
			box-shadow:0 2px 0 rgba(2,6,23,.04), 0 1px 2px rgba(2,6,23,.08)
		}
		button{
			display:inline-block;border:0;border-radius:12px;padding:12px 16px;font-weight:800;color:#fff;cursor:pointer;text-decoration:none;
			background:linear-gradient(135deg,#22d3ee,#6366f1);box-shadow:0 10px 24px rgba(99,102,241,.35);
			transition: transform .08s ease, box-shadow .2s ease
		}
		button:hover{ transform: translateY(-1px); box-shadow:0 12px 30px rgba(99,102,241,.45) }
		button:active{ transform: translateY(0) }
		.kpiRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:14px}
		.kpi{background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:10px}
		.kpi h4{margin:0 0 6px;font-size:12px;font-weight:800;color:#0ea5e9}
		.kpi .muted{font-size:12px;color:#475569}
		.msg{color:#b91c1c;margin-top:16px;font-weight:900;text-align:center;font-size:18px;padding:10px 14px;border-radius:12px;background:#fee2e2;border:1px solid #fecaca}
		.footer{margin:16px auto 0;text-align:center;color:#0b1220cc;font-weight:600;font-size:13px}
	</style>
</head>
<body>
	<div class="container">
		<div style="text-align:right;margin-bottom:6px"><button type="button" onclick="window.location.href='?dqa_logout=1';" title="Return to the DQA Tools page and remove your uploaded data from the server">Logout</button></div>
		<div class="header">
			<div class="logo">DQA</div>
			<div class="title">
				<h1><?=h($APP_NAME)?></h1>
				<p>Upload CSV or Excel (.xlsx) file and generate a precise desk review instantly</p>
			</div>
		</div>

		<div class="card">
			<div class="cardHeader"><h3>Upload CSV or Excel (.xlsx) file</h3></div>
			<div class="cardInner">
				<form method="post" enctype="multipart/form-data">
					<input type="hidden" name="action" value="upload">
					<input type="hidden" name="access_code" value="<?=h($GLOBALS['ACCESS_CODE_CURRENT'])?>">
					<div class="formRow">
						<div style="flex:1 1 520px">
							<label>Select CSV or Excel (.xlsx) file</label>
							<input type="file" name="csv" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
							<div style="color:#475569;font-size:15px;margin-top:8px">
								Monthly Data Item Wise Report Across Facility and Across Period should be downloaded from HMIS for uploading (Excel .xlsx file as downloaded, or .csv file)
								<div style="margin-top:6px;font-weight:700;color:#0f172a">Accepted file formats: .csv and .xlsx (no conversion to .csv needed)</div>

<a href="https://hmis.mohfw.gov.in/#!/">HMIS</a>

							</div>
						</div>
						<div style="flex:0 0 auto">
							<button type="submit">Upload & Analyse</button>
						</div>
					</div>

					<div class="kpiRow">
						<div class="kpi"><h3>Availability</h3><div class="muted">All reports for the study period must be available in the portal at the time of assessment</div></div>
						<div class="kpi"><h3>Completeness</h3><div class="muted">All immunization related data fields (M9 section) must be filled in HMIS portal</div></div>
						<div class="kpi"><h3>Accuracy</h3><div class="muted">Identification of logical errors and outliers in immunization data of HMIS portal</div></div>
						<div class="kpi"><h3>Consistency</h3><div class="muted">Identification of discrepencies as per immunization logics</div></div>
					</div>
				</form>

				<?php if($msg): ?><div class="msg"><?=h($msg)?></div><?php endif; ?>
				<div class="footer">Your file is processed temporarily hence not saved on the server.</div>
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
	echo "<th rowspan='2'>Block Name</th>";
	echo "<th rowspan='2'>Facility Name</th>";
	foreach($vaccines as $vx){
		echo "<th class='lvl1' colspan='".(int)count($months)."'>".h($vx)."</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
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
/** Outliers table: Month1 value | Month2 value | % Change */
function render_outliers_two_level($t3_web){
	$vaccines = $t3_web['vaccines'];
	$pairs = $t3_web['pairs'];
	$rows = $t3_web['rows'];

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	echo "<th rowspan='2'>Block Name</th>";
	echo "<th rowspan='2'>Facility Name</th>";
	foreach($vaccines as $vx){
		echo "<th class='lvl1' colspan='".(int)(count($pairs)*3)."'>".h($vx)."</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
		foreach($vaccines as $vx){
			foreach($pairs as $p){
				$pk = $p['k'];
				$cell = (isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk])) ? $row['cells'][$vx][$pk] : null;
				if(!$cell || empty($cell['hit'])){
					echo "<td></td><td></td><td></td>";
				} else {
					$a = $cell['a']; $b = $cell['b']; $pct = $cell['pct'];
					$pctStr = !empty($cell['fromZero']) ? 'from 0' : (($pct===null) ? '' : (($pct>0?'+':'').round($pct,1).'%')); /* (changed 2026-10) a rise from 0 has no % */
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
	echo "<th rowspan='2'>Block Name</th>";
	echo "<th rowspan='2'>Facility Name</th>";
	foreach($months as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='3'>".h($ml)."</th>";
	}
	echo "<th class='lvl1' colspan='3'>All months</th>";
	echo "</tr>";
	echo "<tr>";
	foreach($months as $mk){
		echo "<th class='lvl2'>".h($from)."</th>";
		echo "<th class='lvl2'>".h($to)."</th>";
		echo "<th class='lvl2'>% Dropouts</th>";
	}
	echo "<th class='lvl2'>".h($from)."</th>";
	echo "<th class='lvl2'>".h($to)."</th>";
	echo "<th class='lvl2'>% Dropouts</th>";
	echo "</tr>";

	foreach($rows as $rk=>$row){
		echo "<tr>";
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
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
function render_coadmin_two_level($web){
	$vaccines = $web['vaccines'];
	$months = $web['months'];
	$monthLabels = $web['monthLabels'];
	$rows = $web['rows'];

	echo "<div class='tblWrap'>";
	echo "<table class='twoHead'>";
	echo "<tr>";
	echo "<th rowspan='2'>Block Name</th>";
	echo "<th rowspan='2'>Facility Name</th>";
	foreach($months as $mk){
		$ml = isset($monthLabels[$mk]) ? $monthLabels[$mk] : $mk;
		echo "<th class='lvl1' colspan='".(int)count($vaccines)."'>".h($ml)."</th>";
	}
	echo "<th class='lvl1' colspan='".(int)count($vaccines)."'>All months</th>";
	echo "</tr>";
	echo "<tr>";
	foreach($months as $mk){
		foreach($vaccines as $vx){ echo "<th class='lvl2'>".h($vx)."</th>"; }
	}
	foreach($vaccines as $vx){ echo "<th class='lvl2'>".h($vx)."</th>"; }
	echo "</tr>";

	foreach($rows as $rk=>$row){
		echo "<tr>";
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";

		/* (changed 2026-10) pink = the odd value(s) out of a month that differs (same
		   cells as the highlighted download); "All months" totals are reference only. */
		foreach($months as $mk){
			$dqa_mask = isset($row['odd'][$mk]) ? (int)$row['odd'][$mk] : 0;
			foreach($vaccines as $dqa_vi=>$vx){
				$v = isset($row['vals'][$mk][$vx]) ? $row['vals'][$mk][$vx] : null;
				$cls = ($dqa_mask & (1 << $dqa_vi)) ? " class='pinkCell'" : "";
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
/* ==================================================================
   (added 2026-10) data of the DQA 2-pager report (small unlabelled button, top left)
   ------------------------------------------------------------------
   The report (A4 portrait, laid out like the DQA 2-pager template) is drawn in
   the browser and saved with the print window's "Save as PDF". Its data is built
   here only from figures this page already shows, so every number agrees with
   the cards, panels and Overall Score:
   - the KPI cards of the Overall Score components (in card order) and their totals;
   - the units each card counts = the same unit sets as its table, chart and
     highlighted download ($_SESSION['pink_fac_sets'][downloadKey]);
   - the component and overall scores and the denominator (units under the
     current selection).
   Issues of a unit = number of those KPI cards that count the unit.
   Nothing is written to the session or to the database.
   ================================================================== */
function dqa2p_month_full($mk){
	$p = explode('-', (string)$mk);
	$y = isset($p[0]) ? (int)$p[0] : 0; $m = isset($p[1]) ? (int)$p[1] : 0;
	if($y <= 0 || $m < 1 || $m > 12) return (string)$mk;
	$n = array('January','February','March','April','May','June','July','August','September','October','November','December');
	return $n[$m - 1].' '.$y;
}
function dqa2p_month_short($mk){
	$p = explode('-', (string)$mk);
	$y = isset($p[0]) ? (int)$p[0] : 0; $m = isset($p[1]) ? (int)$p[1] : 0;
	if($y <= 0 || $m < 1 || $m > 12) return (string)$mk;
	$n = array('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec');
	return $n[$m - 1].'-'.substr(sprintf('%04d', $y), -2);
}
/* Selected months: "January 2026" / "January 2026 to March 2026" / a list when months are missing in between */
function dqa2p_period($keys, $short){
	$k = array_values(array_unique(array_map('strval', (array)$keys)));
	sort($k, SORT_STRING);
	$n = count($k);
	if($n === 0) return '—';
	$f = $short ? 'dqa2p_month_short' : 'dqa2p_month_full';
	if($n === 1) return $f($k[0]);
	$ix = array();
	foreach($k as $mk){ $p = explode('-', $mk); $ix[] = (isset($p[0]) ? (int)$p[0] : 0) * 12 + (isset($p[1]) ? (int)$p[1] : 0); }
	$contig = true;
	for($i = 1; $i < $n; $i++){ if($ix[$i] !== $ix[$i - 1] + 1){ $contig = false; break; } }
	if($contig) return $f($k[0]).' to '.$f($k[$n - 1]);
	return implode(', ', array_map($f, $k));
}
function dqa2p_build($p){
	$den = (int)$p['den'];
	$units = is_array($p['units']) ? $p['units'] : array();
	$sets = is_array($p['sets']) ? $p['sets'] : array();
	$uw = ($p['kind'] === 'uw');
	/* every unit under the selection: its block (as in the tool's tables and charts) and its name */
	$blockOf = array(); $nameOf = array(); $issues = array();
	foreach($units as $k => $u){
		$blockOf[$k] = display_block_label(isset($u['block']) ? $u['block'] : '');
		$nameOf[$k] = (string)($uw ? (isset($u['sessionsite']) ? $u['sessionsite'] : '') : (isset($u['facility']) ? $u['facility'] : ''));
		$issues[$k] = 0;
	}
	if($uw){
		/* one session-site name used by two sites of a block (under different facilities): the facility is added */
		$grp = array();
		foreach($nameOf as $k => $nm){ $grp[$blockOf[$k]."\x1F".$nm][] = $k; }
		foreach($grp as $ks){
			if(count($ks) < 2) continue;
			foreach($ks as $k){
				$fn = trim((string)(isset($units[$k]['facility']) ? $units[$k]['facility'] : ''));
				if($fn !== '') $nameOf[$k] .= ' ('.$fn.')';
			}
		}
	}
	$blocks = array();
	foreach($blockOf as $k => $b){ $blocks[$b][] = $k; }
	/* (changed 2026-10, web parity) the score cards are always the standard checks, so the
	   Dropouts / Outliers names carry the standard cut-offs */
	$qDrop = array('20% or more');
	$qOut = array('Extreme increase or decrease');
	/* KPI cards of the Overall Score components */
	$comps = array(); $chk = array();
	foreach($p['comps'] as $gid => $g){
		$sc = isset($g['score']) ? $g['score'] : null;
		$comps[$gid] = array('id'=>(string)$gid, 'name'=>(string)$g['name'], 'score'=>($sc === null ? null : number_format((float)$sc, 1, '.', '')), 'kpis'=>array(), 'worst'=>null);
	}
	$kpiBlocks = array();  /* [component][kpi index] => block => units */
	$typeSeen = array();   /* block => KPI => true (KPIs with at least one unit in the block) */
	foreach($p['cards'] as $c){
		$gid = isset($c['group']) ? (string)$c['group'] : '';
		if(!isset($comps[$gid])) continue;
		$n = isset($c['stat']['total']) ? (int)$c['stat']['total'] : 0;
		$dk = isset($c['downloadKey']) ? (string)$c['downloadKey'] : '';
		$list = isset($sets[$dk]) ? (array)$sets[$dk] : array();
		$byB = array(); $cnt = 0; $seenU = array();
		foreach($list as $k){
			if(!isset($units[$k]) || isset($seenU[$k])) continue;
			$seenU[$k] = true;
			$cnt++;
			$issues[$k]++;
			$b = $blockOf[$k];
			$byB[$b] = isset($byB[$b]) ? $byB[$b] + 1 : 1;
			$typeSeen[$b][$gid.'|'.$c['id']] = true;
		}
		if($cnt !== $n) $chk[] = (string)$c['name'];
		$q = '';
		if(strpos((string)$c['id'], 'drop_') === 0 && !empty($qDrop)) $q = ' ('.implode(', ', $qDrop).')';
		elseif((string)$c['id'] === 't3' && !empty($qOut)) $q = ' ('.implode(', ', $qOut).')';
		$comps[$gid]['kpis'][] = array('id'=>(string)$c['id'], 'name'=>(string)$c['name'], 'q'=>$q, 'n'=>$n,
			'pct'=>($den > 0 ? number_format($n * 100.0 / $den, 1) : '0.0'), 'worst'=>false);
		$kpiBlocks[$gid][] = $byB;
	}
	/* top issue of each component (the check flagging the most units; since 2026-10 it no longer sets the score) and its units per block */
	foreach($comps as $gid => $g){
		$max = 0;
		foreach($g['kpis'] as $kp){ if($kp['n'] > $max) $max = $kp['n']; }
		if($max <= 0 || $den <= 0) continue;
		$names = array(); $first = null;
		foreach($g['kpis'] as $i => $kp){
			if($kp['n'] !== $max) continue;
			$comps[$gid]['kpis'][$i]['worst'] = true;
			$names[] = $kp['name'].$kp['q'];
			if($first === null) $first = $i;
		}
		$byB = isset($kpiBlocks[$gid][$first]) ? $kpiBlocks[$gid][$first] : array();
		$bl = array();
		foreach($blocks as $b => $ks){ $bl[] = array('b'=>(string)$b, 'n'=>(isset($byB[$b]) ? (int)$byB[$b] : 0)); }
		usort($bl, function($x, $y){ if($x['n'] !== $y['n']) return ($x['n'] > $y['n']) ? -1 : 1; return strnatcasecmp($x['b'], $y['b']); });
		$comps[$gid]['worst'] = array('n'=>$max, 'pct'=>number_format($max * 100.0 / $den, 1), 'names'=>$names,
			'chart'=>$g['kpis'][$first]['name'].$g['kpis'][$first]['q'], 'blocks'=>$bl);
	}
	/* blocks: units by number of issues, KPIs with at least one unit in the block, top 3 units */
	$rowsB = array(); $tot = array('g4'=>0, 'g13'=>0, 'g0'=>0, 'tot'=>0);
	foreach($blocks as $b => $ks){
		$g4 = 0; $g13 = 0; $g0 = 0; $cand = array();
		foreach($ks as $k){
			$is = $issues[$k];
			if($is >= 4) $g4++; elseif($is >= 1) $g13++; else $g0++;
			if($is >= 1) $cand[] = array('u'=>$nameOf[$k], 'n'=>$is);
		}
		usort($cand, function($x, $y){ if($x['n'] !== $y['n']) return ($x['n'] > $y['n']) ? -1 : 1; return strnatcasecmp($x['u'], $y['u']); });
		$rowsB[] = array('b'=>(string)$b, 'types'=>(isset($typeSeen[$b]) ? count($typeSeen[$b]) : 0), 'g4'=>$g4, 'g13'=>$g13, 'g0'=>$g0, 'tot'=>count($ks), 'top'=>array_slice($cand, 0, 3));
		$tot['g4'] += $g4; $tot['g13'] += $g13; $tot['g0'] += $g0; $tot['tot'] += count($ks);
	}
	usort($rowsB, function($x, $y){ if($x['types'] !== $y['types']) return ($x['types'] > $y['types']) ? -1 : 1; return strnatcasecmp($x['b'], $y['b']); });
	$nKpi = 0; foreach($comps as $g){ $nKpi += count($g['kpis']); }
	$dist = (string)$p['district'];
	$file = 'DQA_2-pager_'.$p['tool'].(($dist !== '' && $dist !== '—' && $dist !== 'Multiple') ? '_'.$dist : '').'_'.dqa2p_period($p['months'], true);
	$file = trim(preg_replace('/_+/', '_', preg_replace('/[^A-Za-z0-9\-]+/', '_', $file)), '_');
	return array(
		'tool'=>(string)$p['tool'], 'unit'=>($uw ? 'session sites' : 'facilities'), 'unitOne'=>($uw ? 'session site' : 'facility'),
		'state'=>(string)$p['state'], 'district'=>$dist,
		'period'=>dqa2p_period($p['months'], false), 'periodShort'=>dqa2p_period($p['months'], true),
		'den'=>$den, 'blocks'=>(int)$p['blocksCount'],
		'overall'=>($p['overall'] === null ? null : number_format((float)$p['overall'], 1)),
		'selection'=>array_values(array_map('strval', (array)$p['selection'])),
		'comps'=>array_values($comps), 'kpiCount'=>$nKpi,
		'blockRows'=>$rowsB, 'totals'=>$tot, 'chk'=>$chk, 'file'=>$file
	);
}
/* JSON for a <script> block: <, >, &, quotes escaped; invalid UTF-8 replaced instead of failing */
function dqa2p_json($data){
	$fl = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE;
	if(defined('JSON_INVALID_UTF8_SUBSTITUTE')) $fl |= JSON_INVALID_UTF8_SUBSTITUTE;
	$j = json_encode($data, $fl);
	return ($j === false) ? 'null' : $j;
}
/* ============== end of added DQA 2-pager data ============== */

function render_results_with_data(){
	$APP_NAME = $GLOBALS['APP_NAME'];
	$BASE_URL = $GLOBALS['BASE_URL'];

	$header = $_SESSION['csv_header'];
	$rows = $_SESSION['csv_rows'];
	$idxBlock = $_SESSION['idxBlock'];
	$idxFac = $_SESSION['idxFac'];
	$idxMonth = $_SESSION['idxMonth'];
	$idxOwner = isset($_SESSION['idxOwner']) ? $_SESSION['idxOwner'] : null;
	$idxRU = isset($_SESSION['idxRU']) ? $_SESSION['idxRU'] : null;
	$idxState = isset($_SESSION['idxState']) ? $_SESSION['idxState'] : null;
	$idxDist = isset($_SESSION['idxDist']) ? $_SESSION['idxDist'] : null;
	$filters = isset($_SESSION['filters']) ? $_SESSION['filters'] : [];
	$fileName = isset($_SESSION['file_name']) ? $_SESSION['file_name'] : 'uploaded.csv';
	$hasApplied = isset($_SESSION['hasApplied']) ? (bool)$_SESSION['hasApplied'] : false;
	$justUploaded = !empty($_SESSION['just_uploaded']);
	unset($_SESSION['just_uploaded']);
	/* (added 2026-10) the download data of the previous page is rebuilt below: release it
	   first, so large files stay within the memory limit */
	$_SESSION['exports'] = [];
	$_SESSION['dqa_hl'] = [];
	$_SESSION['pink_fac_sets'] = []; $_SESSION['pink_outlier_hits'] = []; $_SESSION['pink_dropout_hits'] = []; $_SESSION['pink_repeat_hits'] = [];

	$BASE_VAX = ['BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2'];

	$ADD_VAX = ['RVV1','RVV2','RVV3','fIPV1','fIPV2','fIPV3','PCV1','PCV2','PCV Booster','HepB0','DPT 1st Booster'];

	/* Build data map per (block, facility)
	   (changed 2026-10) A facility = Block Name + Facility Name compared without
	   case/extra-space differences (+ Facility Code when the file has that column, so
	   two facilities sharing one name in a block stay separate). Every month keeps the
	   number of the row it was read from ('ri'), so the highlighted download marks
	   exactly the cells counted on screen. Month labels carry the year (Apr-26). */
	$idxFacCode = null;
	foreach($header as $dqa_hi=>$dqa_hv){
		if($dqa_hi!==$idxFac && $dqa_hi!==$idxBlock && dqa_header_compact($dqa_hv)==='facilitycode'){ $idxFacCode = $dqa_hi; break; }
	}
	$facData=[];
	$allMonthKeys=[];
	$statesSet=[];
	$distsSet=[];
	$dqaDupRows = 0;      /* rows repeating a facility + month already read */
	$dqaDupExample = '';
	$dqaBadMonthRows = 0; /* rows left out because their Month cannot be read */
	$dqaBadMonthExample = '';
	$dqaBlockCanon = [];
	foreach($rows as $dqa_ri=>$r){
		$block = isset($r[$idxBlock]) ? trim((string)$r[$idxBlock]) : '';
		$fac = isset($r[$idxFac]) ? trim((string)$r[$idxFac]) : '';
		$monRaw= isset($r[$idxMonth]) ? (string)$r[$idxMonth] : '';
		if($block==='' && $fac==='') continue;
		if(trim($monRaw)==='') continue;
		$mKey = month_key($monRaw);
		if($mKey===null){ /* (added) counted for a note on the results page */
			$dqaBadMonthRows++;
			if($dqaBadMonthExample==='') $dqaBadMonthExample = trim($monRaw);
			continue;
		}
		$mLbl = month_label_from_key_my($mKey);
		$facCode = ($idxFacCode!==null && isset($r[$idxFacCode])) ? trim((string)$r[$idxFacCode]) : '';

		$own = ($idxOwner!==null && isset($r[$idxOwner])) ? normalize_ownership($r[$idxOwner]) : '';
		$ru = ($idxRU!==null && isset($r[$idxRU])) ? normalize_ru($r[$idxRU]) : '';

		if($idxState!==null && isset($r[$idxState])){
			$sv=trim((string)$r[$idxState]);
			if($sv!=='') $statesSet[$sv]=true;
		}
		if($idxDist!==null && isset($r[$idxDist])){
			$dv=trim((string)$r[$idxDist]);
			if($dv!=='') $distsSet[$dv]=true;
		}

		$allMonthKeys[$mKey]=true;
		/* (changed 2026-10, web parity) a facility = Block Name + Facility Name as written
		   (trimmed), the same unit the web application counts */
		$key = $block.'||'.$fac;
		if(!isset($facData[$key])){
			/* one spelling per block (the first one met), so options, charts and counts agree */
			$dqa_bk = dqa_unit_norm($block);
			if(!isset($dqaBlockCanon[$dqa_bk])) $dqaBlockCanon[$dqa_bk] = $block;
			$facData[$key]=[
				'block'=>$dqaBlockCanon[$dqa_bk],'facility'=>$fac,'code'=>$facCode,
				'ownership'=>'','ru'=>'',
				'months'=>[]
			];
		}

		if($own!==''){
			if($facData[$key]['ownership']===''){ $facData[$key]['ownership']=$own; }
			elseif($facData[$key]['ownership']!==$own){ $facData[$key]['ownership']='Mixed'; }
		}
		if($ru!==''){
			if($facData[$key]['ru']===''){ $facData[$key]['ru']=$ru; }
			elseif($facData[$key]['ru']!==$ru){ $facData[$key]['ru']='Mixed'; }
		}

		/* (changed 2026-10, web parity) a repeated facility + month: the FIRST row is the one
		   analysed (and highlighted), as in the web application; the results page shows a
		   note about it. */
		if(isset($facData[$key]['months'][$mKey])){
			$dqaDupRows++;
			if($dqaDupExample==='') $dqaDupExample = display_block_label($block).' / '.$fac.' / '.$mLbl;
			continue;
		}
		$facData[$key]['months'][$mKey]=['label'=>$mLbl,'raw'=>$monRaw,'ri'=>$dqa_ri,'vals'=>[]];
		for($ci=$idxMonth+1;$ci<count($header);$ci++){
			$facData[$key]['months'][$mKey]['vals'][$ci]=as_num_or_null(isset($r[$ci]) ? $r[$ci] : null);
		}
	}
	/* One Block + Facility Name used by more than one facility (other Facility Code,
	   Ownership or Rural/Urban): the name is followed by what tells them apart, e.g.
	   "Kishangarh (CHC) [Private]", so table rows are never ambiguous. */
	$dqaNameGroups = [];
	foreach($facData as $dqa_k=>$dqa_fd){
		$dqaNameGroups[dqa_unit_norm($dqa_fd['block']).'||'.dqa_unit_norm($dqa_fd['facility'])][] = $dqa_k;
	}
	foreach($dqaNameGroups as $dqa_keys){
		if(count($dqa_keys) < 2) continue;
		$dqa_vary = [];
		foreach(['code','ownership','ru'] as $dqa_att){
			$dqa_vals = [];
			foreach($dqa_keys as $dqa_k){ $dqa_vals[(string)$facData[$dqa_k][$dqa_att]] = true; }
			$dqa_vary[$dqa_att] = (count($dqa_vals) > 1);
		}
		foreach($dqa_keys as $dqa_k){
			$dqa_parts = [];
			if($dqa_vary['code']) $dqa_parts[] = ($facData[$dqa_k]['code']!=='' ? $facData[$dqa_k]['code'] : 'no code');
			if($dqa_vary['ownership']) $dqa_parts[] = ($facData[$dqa_k]['ownership']!=='' ? $facData[$dqa_k]['ownership'] : 'Ownership blank');
			if($dqa_vary['ru']) $dqa_parts[] = ($facData[$dqa_k]['ru']!=='' ? $facData[$dqa_k]['ru'] : 'Rural/Urban blank');
			if(!empty($dqa_parts)) $facData[$dqa_k]['facility'] .= ' ['.implode(', ', $dqa_parts).']';
		}
	}

	$monthKeys=array_keys($allMonthKeys);
	sort($monthKeys,SORT_STRING);
	$singleMonthDataset=(count($monthKeys)===1);

	/* Outliers dropdown hidden ONLY for 1-month dataset */
	$showOutliersDropdown = (count($monthKeys) > 1);
	/* (changed 2026-10, web parity) no dropout for a 1-month dataset, so its dropdown is hidden too */
	$showDropoutsDropdown = (count($monthKeys) > 1);

	/* Meta line */
	$stateName = '—';
	$distName = '—';
	if(count($statesSet)===1){ foreach($statesSet as $k=>$v){ $stateName=$k; break; } }
	elseif(count($statesSet)>1){ $stateName='Multiple'; }
	if(count($distsSet)===1){ foreach($distsSet as $k=>$v){ $distName=$k; break; } }
	elseif(count($distsSet)>1){ $distName='Multiple'; }

	/* (changed 2026-10) Duration counts the months present in the file (a missing
	   month in between is not counted, and the months are then listed). */
	$durationStr = dqa_months_label($monthKeys);

	/* Duration HTML (line break before bracket text as requested) */
	$durationStrHtml = h($durationStr);
	$durationStrHtml = preg_replace('/\s*\(/','<br>(', $durationStrHtml, 1);

	/* Target indicator map */
	$indicatorIdxTargets=[];
	for($i=$idxMonth+1;$i<count($header);$i++){
		$detect=detect_target_indicator($header[$i]);
		if($detect){
			$indicatorIdxTargets[$i]=[
				'header'=>$header[$i],
				'short'=>$detect['short'],
				'code'=>$detect['code']
			];
		}
	}
	$idxByShort = [];
	foreach($indicatorIdxTargets as $ci=>$meta){ $idxByShort[$meta['short']] = $ci; }

	/* NEW: all indicators after Month (short form) */
	$idxByShortAll = [];
	$allIndicatorMeta = [];
	for($ci=$idxMonth+1;$ci<count($header);$ci++){
		$short = indicator_short_from_header($header[$ci]);
		$base = $short;
		$k=1;
		while(isset($idxByShortAll[$short])){
			$k++;
			$short = $base.'-'.$k;
		}
		$idxByShortAll[$short] = $ci;
		$allIndicatorMeta[$short] = ['idx'=>$ci,'header'=>$header[$ci]];
	}
	$allDetectedVax = array_keys($idxByShortAll);
	sort($allDetectedVax, SORT_NATURAL|SORT_FLAG_CASE);

	/* Additional Indicators dropdown options (fixed list as requested) */
	$ADD_VAX = ['RVV1','RVV2','RVV3','fIPV1','fIPV2','fIPV3','PCV1','PCV2','PCV Booster','HepB0','DPT 1st Booster'];
	$KEY_VAX = $BASE_VAX;
	/* (changed 2026-10, web parity) the standard outlier vaccines: OPV1 / OPV3 can still be
	   ticked for the screen, the Overall Score always uses this list */
	$STD_OUT_VAX = ['BCG','Penta1','Penta3','MR1','MR2'];
	/* (added 2026-10, web parity) M9 Child Immunisation columns (Availability checks) and the
	   Key Missing Indicators items (every M9 item except JE, delayed MR 1st dose and Typhoid) */
	$m9Cols = dqa_m9_columns($header, $idxMonth);
	$keyMissingCols = [];
	foreach($m9Cols as $dqa_ci){
		$dqa_txt = trim((string)$header[$dqa_ci]);
		if($dqa_txt !== '' && !dqa_key_missing_excluded($dqa_txt)) $keyMissingCols[] = $dqa_ci;
	}

$find = function($code) use ($header){ return find_index_by_code($header,$code); };

	$iP1 =$find('9.1.3.');
	$iP2 =$find('9.1.4.');
	$iP3 =$find('9.1.5.');
	$iO1 =$find('9.1.7.');
	$iO2 =$find('9.1.8.');
	$iO3 =$find('9.1.9.');
	$iMR1=$find('9.2.2.');
	$iMR2=$find('9.4.1.');
	$iRVV1=$find('9.1.13.');
	$iRVV2=$find('9.1.14.');
	$iRVV3=$find('9.1.15.');
	$iPCV1=$find('9.1.16.');
	$iPCV2=$find('9.1.17.');
	$ifIPV1=$find('9.1.11.');
	$ifIPV2=$find('9.1.12.');
	$ifIPV3=$find('9.2.1.');
	$iPCVB=$find('9.2.4.');
	$iDPTB=$find('9.4.2.');
	$iSessP = $find('sessions planned');
	$iSessH = $find('sessions held');
	/* (removed 2026-10, web parity) the FIC>MR1 and "Public facilities reporting Typhoid"
	   checks are not part of the web application, so they are no longer computed or scored */

	/* Option sets */
	$allBlocks=[];
	$allMonths=[];
	foreach($facData as $fd){
		$allBlocks[$fd['block']]=true;
		foreach($fd['months'] as $mk=>$md){ $allMonths[$mk]=$md['label']; }
	}
	ksort($allBlocks, SORT_NATURAL|SORT_FLAG_CASE);
	ksort($allMonths, SORT_STRING);
	$_SESSION['allMonthsMap'] = $allMonths;

	/* Normalize Select All */
	$OUT_INC_ALL = ['INC_LOW','INC_MOD','INC_EXT'];
	$OUT_DROP_ALL = ['DROP_LOW','DROP_MOD','DROP_EXT'];
	$DROP_RANGE_ALL = ['R5_10','R11_20','R20P'];
	/* (changed 2026-10, web parity) the 3 standard (scored) dropout pairs; BCG→MR1 stays as an optional tick for the screen */
	$PAIR_DEFAULTS = ['Penta1→Penta3','MR1→MR2','Penta3→MR1'];
	$PAIR_OPTIONS = ['Penta1→Penta3','MR1→MR2','Penta3→MR1','BCG→MR1'];

	$expandAll = function($arr,$all){
		if(!is_array($arr)) $arr=[];
		if(in_array('__ALL__',$arr,true)) return $all;
		return $arr;
	};
	/* (changed 2026-10) After Apply Filter, an empty selection means "Select All" for the
	   filters whose boxes are shown ticked when nothing is selected (Blocks, Months,
	   Ownership, Rural/Urban, Key Indicators, Dropout ranges and pairs), as in dqauwin.php:
	   the analysis then always matches the ticks on screen (before, unticking every block
	   or both Ownership boxes analysed nothing while every box still showed ticked).
	   Additional Indicators keep "nothing ticked = none". */
	$expandSel = function($arr,$all) use ($expandAll, $hasApplied){
		$arr = $expandAll($arr,$all);
		return ($hasApplied && empty($arr)) ? $all : $arr;
	};

	$filters['blocks'] = $expandSel(isset($filters['blocks']) ? $filters['blocks'] : [], array_keys($allBlocks));
	$filters['months'] = $expandSel(isset($filters['months']) ? $filters['months'] : [], array_keys($allMonths));
	$filters['ownership'] = $expandSel(isset($filters['ownership']) ? $filters['ownership'] : [], ['Public','Private']);
	$filters['ru'] = $expandSel(isset($filters['ru']) ? $filters['ru'] : [], ['Rural','Urban']);
	$filters['outliers_inc'] = $expandAll(isset($filters['outliers_inc']) ? $filters['outliers_inc'] : [], $OUT_INC_ALL);
	$filters['outliers_drop'] = $expandAll(isset($filters['outliers_drop']) ? $filters['outliers_drop'] : [], $OUT_DROP_ALL);
	$filters['outliers_vax'] = $expandAll(isset($filters['outliers_vax']) ? $filters['outliers_vax'] : [], $KEY_VAX);
	if(empty($filters['outliers_vax'])) $filters['outliers_vax'] = $STD_OUT_VAX; /* (changed 2026-10) nothing ticked = the standard outlier vaccines */
	$filters['add_vax'] = $expandAll(isset($filters['add_vax']) ? $filters['add_vax'] : [], $ADD_VAX);
	$filters['drop_ranges'] = $expandSel(isset($filters['drop_ranges']) ? $filters['drop_ranges'] : [], $DROP_RANGE_ALL);
	$filters['drop_pairs'] = $expandAll(isset($filters['drop_pairs']) ? $filters['drop_pairs'] : [], $PAIR_OPTIONS);
	if(empty($filters['drop_pairs'])) $filters['drop_pairs'] = $PAIR_DEFAULTS; /* (changed 2026-10) nothing ticked = the standard pairs */

	if(!isset($filters['drop_from'])) $filters['drop_from'] = [];
	if(!is_array($filters['drop_from'])) $filters['drop_from'] = [$filters['drop_from']];
	if(!isset($filters['drop_to'])) $filters['drop_to'] = [];
	if(!is_array($filters['drop_to'])) $filters['drop_to'] = [$filters['drop_to']];

	/* NEW: inconsistencies builder arrays */
	if(!isset($filters['incons_from'])) $filters['incons_from'] = [];
	if(!is_array($filters['incons_from'])) $filters['incons_from'] = [$filters['incons_from']];
	if(!isset($filters['incons_to'])) $filters['incons_to'] = [];
	if(!is_array($filters['incons_to'])) $filters['incons_to'] = [$filters['incons_to']];

	/* Clean empty */
	$df=[]; foreach((array)$filters['drop_from'] as $v){ $v=trim((string)$v); if($v!=='') $df[]=$v; } $filters['drop_from']=$df;
	$dt=[]; foreach((array)$filters['drop_to'] as $v){ $v=trim((string)$v); if($v!=='') $dt[]=$v; } $filters['drop_to']=$dt;

	$ifrom=[]; foreach((array)$filters['incons_from'] as $v){ $v=trim((string)$v); if($v!=='') $ifrom[]=$v; } $filters['incons_from']=$ifrom;
	$ito=[]; foreach((array)$filters['incons_to'] as $v){ $v=trim((string)$v); if($v!=='') $ito[]=$v; } $filters['incons_to']=$ito;

	$filters['active_group'] = isset($filters['active_group']) ? $filters['active_group'] : '';
	$_SESSION['filters'] = $filters;

	/* Apply global filters */
	$selBlocks = array_fill_keys($filters['blocks'], true);

	if (empty($filters['months'])) {
		$filters['months'] = array_keys($allMonths);  // select all months by default
	}
	$selMonths = array_fill_keys($filters['months'], true);

	$selOwner = array_fill_keys($filters['ownership'], true);
	$selRU = array_fill_keys($filters['ru'], true);

	/* (changed 2026-10) Ownership / Rural-Urban filters:
	   - a file without the Ownership (or Rural/Urban) column is not filtered on it
	     (that filter is hidden), instead of every facility being dropped;
	   - with both options ticked (the default) every facility is kept, including those
	     whose Ownership / Rural-Urban is blank, unrecognised or changes between months
	     ("Mixed"); with one option ticked only facilities of that kind are kept. */
	$dqa_set_eq = function($sel, $all){
		$s = array_values(array_unique(array_map('strval', (array)$sel)));
		$a = array_values(array_unique(array_map('strval', (array)$all)));
		sort($s, SORT_STRING); sort($a, SORT_STRING);
		return $s === $a;
	};
	$dqaOwnOn = ($idxOwner !== null);
	$dqaRuOn  = ($idxRU !== null);
	$dqaOwnAll = $dqa_set_eq($filters['ownership'], ['Public','Private']);
	$dqaRuAll  = $dqa_set_eq($filters['ru'], ['Rural','Urban']);

	$facFiltered = [];
	foreach($facData as $key=>$fd){
		/* (changed 2026-10, web parity) a blank Block Name, Ownership or Rural/Urban value is
		   never filtered out, and a facility with no row in the selected months stays in the
		   selection (those months are missing reports: All Indicators Blank), as in the web
		   application */
		$__blk = isset($fd['block']) ? trim((string)$fd['block']) : '';
		if($__blk!=='' && !isset($selBlocks[$__blk])) continue;
		if($dqaOwnOn && !$dqaOwnAll && $fd['ownership']!=='' && !isset($selOwner[$fd['ownership']])) continue;
		if($dqaRuOn && !$dqaRuAll && $fd['ru']!=='' && !isset($selRU[$fd['ru']])) continue;

		$monthsKeep=[];
		foreach($fd['months'] as $mk=>$md){
			if(isset($selMonths[$mk])) $monthsKeep[$mk]=$md;
		}

		$facFiltered[$key]=[
			'block'=>$fd['block'],
			'facility'=>$fd['facility'],
			'ownership'=>$fd['ownership'],
			'ru'=>$fd['ru'],
			'months'=>$monthsKeep
		];
	}

	/* Independent KPIs
	   (changed 2026-10) Counts use the same facility unit as every KPI (Block + Facility
	   Name, see above): "Number of facilities" = facilities in the uploaded file; the
	   percentages and the Overall Score use the facilities under the current selection
	   (ticked blocks / months / ownership / rural-urban). Blank block names are not
	   counted as a block. */
	$globalBlocksSet = [];
	$globalPub=0; $globalPri=0; $globalRur=0; $globalUrb=0;
	foreach($facData as $fd){
		$blockRaw = isset($fd['block']) ? trim((string)$fd['block']) : '';
		if($blockRaw!=='') $globalBlocksSet[dqa_unit_norm($blockRaw)] = true;
		if($fd['ownership']==='Public') $globalPub++; elseif($fd['ownership']==='Private') $globalPri++;
		if($fd['ru']==='Rural') $globalRur++; elseif($fd['ru']==='Urban') $globalUrb++;
	}
	$globalDen = count($facData);
	$globalBlocksCount = count($globalBlocksSet);

	$selBlocksSet = [];
	$selPub=0; $selPri=0; $selRur=0; $selUrb=0;
	foreach($facFiltered as $fd){
		$blockRaw = isset($fd['block']) ? trim((string)$fd['block']) : '';
		if($blockRaw!=='') $selBlocksSet[dqa_unit_norm($blockRaw)] = true;
		if($fd['ownership']==='Public') $selPub++; elseif($fd['ownership']==='Private') $selPri++;
		if($fd['ru']==='Rural') $selRur++; elseif($fd['ru']==='Urban') $selUrb++;
	}
	$selDen = count($facFiltered);
	$selBlocksCount = count($selBlocksSet);

	/* Selected months ordered (always in calendar order) */
	$selMonthKeysOrdered = array_values(array_intersect(array_keys($allMonths), array_map('strval', (array)$filters['months'])));
	if(empty($selMonthKeysOrdered)) $selMonthKeysOrdered = array_keys($allMonths);
	$selMonthLabelsOrdered = [];
	foreach($selMonthKeysOrdered as $mk){ $selMonthLabelsOrdered[$mk] = isset($allMonths[$mk]) ? $allMonths[$mk] : $mk; }

	/* (added 2026-10) Highlight map for "Actual data with highlighted cells":
	   $HL[downloadKey][row number in the uploaded file] = "12,15" (the columns of that row
	   counted by the KPI; "-1" = whole row). Every KPI below records exactly the cells it
	   counts. Kept as short text so that large files stay within the memory limit. */
	$HL = [];
	$hlRow = function($dlKey, $md) use (&$HL){
		if(!$md || !isset($md['ri'])) return;
		$ri = (int)$md['ri'];
		$HL[$dlKey][$ri] = isset($HL[$dlKey][$ri]) ? $HL[$dlKey][$ri].',-1' : '-1';
	};
	$hlCells = function($dlKey, $md, $cols) use (&$HL){
		if(!$md || !isset($md['ri'])) return;
		$t = '';
		foreach((array)$cols as $ci){ if($ci!==null) $t .= ($t==='' ? '' : ',').(int)$ci; }
		if($t==='') return;
		$ri = (int)$md['ri'];
		$HL[$dlKey][$ri] = isset($HL[$dlKey][$ri]) ? $HL[$dlKey][$ri].','.$t : $t;
	};

	/* (changed 2026-10, web parity) Availability reads the M9 Child Immunisation columns only
	   ($m9Cols). Every check also records the facilities it could be evaluated for
	   ($..._eligible): a check no facility could be evaluated for passes its weight on in the
	   Overall Score. Y/N matrices: N = issue, Y = no issue, '–' = could not be checked. */

	/* All Indicators Blank: a selected month with no row, or with every M9 cell blank */
	$t1=[]; $t1_facilities=[]; $t1_any_facilities=[]; $t1_all_facilities=[]; $t1_eligible=[];
	$t1[] = array_merge(['Block Name','Facility Name'], array_values($selMonthLabelsOrdered));
	$totalMonthsSel = count($selMonthKeysOrdered);
	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']),$fd['facility']];
		$hitCount = 0;
		foreach($selMonthKeysOrdered as $mk){
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$isBlank = true; /* no row for the month = the report is missing */
			if($md){
				foreach($m9Cols as $ci){ if(isset($md['vals'][$ci])){ $isBlank = false; break; } }
			}
			$row[] = $isBlank ? 'N' : 'Y';
			if($isBlank){ $hitCount++; if($md) $hlCells('t1', $md, $m9Cols); }
		}
		if($totalMonthsSel > 0) $t1_eligible[$key] = true;
		if($hitCount > 0){
			$t1_facilities[$key]=true;
			$t1[] = $row;
			if($totalMonthsSel>0 && $hitCount === $totalMonthsSel) $t1_all_facilities[$key]=true;
			else $t1_any_facilities[$key]=true;
		}
	}

	/* Indicators having 0 values but not blank: every M9 cell reported and 0 (months with a row) */
	$t0=[]; $t0_facilities=[]; $t0_any_facilities=[]; $t0_all_facilities=[]; $t0_eligible=[]; $t0Hit=[];
	$t0[] = array_merge(['Block Name','Facility Name'], array_values($selMonthLabelsOrdered));
	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']),$fd['facility']];
		$hitCount = 0; $evaluable = 0;
		foreach($selMonthKeysOrdered as $mk){
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$isZero = false;
			if($md){
				$evaluable++;
				$isZero = !empty($m9Cols);
				foreach($m9Cols as $ci){
					if(!isset($md['vals'][$ci]) || (float)$md['vals'][$ci] != 0.0){ $isZero = false; break; }
				}
			}
			$row[] = $md ? ($isZero ? 'N' : 'Y') : '–';
			if($isZero){ $hitCount++; $t0Hit[$key][$mk] = true; $hlCells('t0', $md, $m9Cols); }
		}
		if($evaluable > 0) $t0_eligible[$key] = true;
		if($hitCount > 0){
			$t0_facilities[$key]=true;
			$t0[]=$row;
			if($hitCount === $evaluable) $t0_all_facilities[$key]=true;
			else $t0_any_facilities[$key]=true;
		}
	}

	/* Duplicate Monthly Record (replaces "All Indicators with same values"): the M9 record
	   equals the previous calendar month's record (blank matches blank) with at least one
	   value above 0. The first month, or a month whose previous calendar month is not
	   selected or has no row, cannot be compared ('–'). */
	$t7=[]; $t7_facilities=[]; $t7_any_facilities=[]; $t7_all_facilities=[]; $t7_eligible=[];
	$t7[] = array_merge(['Block Name','Facility Name'], array_values($selMonthLabelsOrdered));
	$repeatHitsByFac = [];
	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']), $fd['facility']];
		$hitCount = 0; $evaluable = 0;
		foreach($selMonthKeysOrdered as $i=>$mk){
			$pk = ($i > 0 && dqa_months_adjacent($selMonthKeysOrdered[$i-1], $mk)) ? $selMonthKeysOrdered[$i-1] : null;
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$pv = ($pk !== null && isset($fd['months'][$pk])) ? $fd['months'][$pk] : null;
			$compared = 0; $same = true; $nonZero = false;
			if($md && $pv){
				foreach($m9Cols as $ci){
					$a = isset($md['vals'][$ci]) ? $md['vals'][$ci] : null;
					$b = isset($pv['vals'][$ci]) ? $pv['vals'][$ci] : null;
					if($a === null && $b === null) continue;
					$compared++;
					if($a === null || $b === null || $a != $b) $same = false;
					if($a !== null && $a != 0) $nonZero = true;
				}
			}
			if($compared === 0){ $row[] = '–'; continue; }
			$evaluable++;
			$isRepeat = ($same && $nonZero);
			$row[] = $isRepeat ? 'N' : 'Y';
			if($isRepeat){ $hitCount++; $hlCells('t7', $md, $m9Cols); $repeatHitsByFac[$key][$mk] = true; }
		}
		if($evaluable > 0) $t7_eligible[$key] = true;
		if($hitCount > 0){
			$t7_facilities[$key] = true;
			$t7[] = $row;
			if($hitCount === $evaluable) $t7_all_facilities[$key] = true;
			else $t7_any_facilities[$key] = true;
		}
	}
	$_SESSION['pink_repeat_hits'] = $repeatHitsByFac;

	/* (added 2026-10, web parity) Session Not Held but Vaccinated: Sessions Held = 0 while
	   Penta1, Penta3, MR1 or MR2 is above 0 (birth doses are given without a session, so
	   they are left out). A month counts when its row reports Sessions Held. */
	$t10=[]; $t10_facilities=[]; $t10_any_facilities=[]; $t10_all_facilities=[]; $t10_eligible=[];
	$t10[] = ['Block Name','Facility Name','Details (months with 0 sessions held but vaccinations reported)'];
	$t10Vax = [];
	foreach(['Penta1'=>$iP1, 'Penta3'=>$iP3, 'MR1'=>$iMR1, 'MR2'=>$iMR2] as $dqa_vx=>$dqa_ci){ if($dqa_ci !== null) $t10Vax[$dqa_vx] = $dqa_ci; }
	$t10Available = ($iSessH !== null && !empty($t10Vax));
	if($t10Available){
		foreach($facFiltered as $key=>$fd){
			$parts = []; $hitCount = 0; $evaluable = 0;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				if(!$md || !isset($md['vals'][$iSessH])) continue;
				$evaluable++;
				if((float)$md['vals'][$iSessH] != 0.0) continue;
				$pos = []; $posCols = [];
				foreach($t10Vax as $vx=>$ci){
					if(isset($md['vals'][$ci]) && $md['vals'][$ci] > 0){ $pos[] = $vx.' '.round($md['vals'][$ci]); $posCols[] = $ci; }
				}
				if(empty($pos)) continue;
				$hitCount++;
				$parts[] = $md['label'].': '.implode(', ', $pos);
				$hlCells('t10', $md, array_merge([$iSessH], $posCols));
			}
			if($evaluable > 0) $t10_eligible[$key] = true;
			if($hitCount > 0){
				$t10_facilities[$key] = true;
				$t10[] = [display_block_label($fd['block']), $fd['facility'], implode('; ', $parts)];
				if($hitCount === $evaluable) $t10_all_facilities[$key] = true;
				else $t10_any_facilities[$key] = true;
			}
		}
	}

	/* Key Missing Indicators (changed 2026-10, web parity): every M9 item except JE, delayed
	   MR 1st dose and Typhoid ($keyMissingCols), whatever the Key / Additional Indicators
	   filters say. Facilities All Indicators Blank flagged are not checked again (they stay
	   in the denominator); a selected month with no row counts as blank. */
	$t2Title='Key Missing Indicators';
	$t2Items = []; /* item label => column */
	foreach($keyMissingCols as $dqa_ci){
		$dqa_lbl = dqa_m9_item_label($header[$dqa_ci]); $dqa_base = $dqa_lbl; $dqa_n = 2;
		while(isset($t2Items[$dqa_lbl])){ $dqa_lbl = $dqa_base.' ('.$dqa_n.')'; $dqa_n++; }
		$t2Items[$dqa_lbl] = $dqa_ci;
	}
	$t2Vax = array_keys($t2Items);
	$t2Runs = (!empty($t2Items) && $totalMonthsSel > 0);

	$t2=[]; $t2_facilities=[]; $t2_any_facilities=[]; $t2_all_facilities=[]; $t2_eligible=[];
	$flatHeader = ['Block Name','Facility Name'];
	foreach($t2Vax as $vx){
		foreach($selMonthKeysOrdered as $mk){
			$flatHeader[] = $vx.' '.(isset($allMonths[$mk]) ? $allMonths[$mk] : $mk);
		}
	}
	$t2[] = $flatHeader;

	$t2_matrix_cache = [];
	$blankCountsByVax = [];
	$blankAllCountsByVax = [];
	foreach($t2Vax as $vx){ $blankCountsByVax[$vx]=0; $blankAllCountsByVax[$vx]=0; }

	foreach($facFiltered as $key=>$fd){
		if(isset($t1_facilities[$key])) continue;
		if($t2Runs) $t2_eligible[$key] = true;
		$row = [display_block_label($fd['block']),$fd['facility']];
		$anyBlank=false;
		$cellMap = [];
		foreach($t2Items as $vx=>$ci){
			$hasBlankForVx = false;
			$vxAllBlank = true;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$isBlank = (!$md || !isset($md['vals'][$ci]));
				$cellMap[$vx][$mk] = $isBlank ? 'N' : 'Y'; /* N = issue, Y = no issue */
				if($isBlank){ $anyBlank=true; $hasBlankForVx=true; if($md) $hlCells('t2', $md, [$ci]); } else { $vxAllBlank = false; }
				$row[] = $cellMap[$vx][$mk];
			}
			if($hasBlankForVx) $blankCountsByVax[$vx]++;
			if($vxAllBlank && $totalMonthsSel > 0) $blankAllCountsByVax[$vx]++;
		}
		if($anyBlank){
			$blankMonths = 0;
			foreach($selMonthKeysOrdered as $mk){
				foreach($t2Vax as $vx){ if($cellMap[$vx][$mk]==='N'){ $blankMonths++; break; } }
			}
			$t2_facilities[$key]=true;
			if($totalMonthsSel>0 && $blankMonths === $totalMonthsSel) $t2_all_facilities[$key]=true;
			else $t2_any_facilities[$key]=true;
			$t2[] = $row;
			$t2_matrix_cache[$key] = [
				'block'=>display_block_label($fd['block']),
				'facility'=>$fd['facility'],
				'cells'=>$cellMap
			];
		}
	}

	arsort($blankCountsByVax);
	arsort($blankAllCountsByVax);
	// Any-month (only) counts exclude facilities that are blank in ALL months for that item
	$blankAnyOnlyCountsByVax = [];
	foreach($t2Vax as $vx){
		$blankAnyOnlyCountsByVax[$vx] = max(0, (int)$blankCountsByVax[$vx] - (int)$blankAllCountsByVax[$vx]);
	}
	arsort($blankAnyOnlyCountsByVax);
	$top3BlankAny = [];
	foreach($blankAnyOnlyCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankAny[] = $vx.' ('.$cnt.')'; if(count($top3BlankAny)===3) break; }
	$top3BlankAll = [];
	foreach($blankAllCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankAll[] = $vx.' ('.$cnt.')'; if(count($top3BlankAll)===3) break; }
	$top3BlankOverall = [];
	foreach($blankCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankOverall[] = $vx.' ('.$cnt.')'; if(count($top3BlankOverall)===3) break; }

	/* Sessions Held > Planned (scored under Consistency since 2026-10, web parity): judged
	   month by month; a month counts when both Sessions Planned and Sessions Held are
	   reported and Held > Planned (also when Planned is 0). A blank month is never read as 0.
	   The Totals column (months where both are reported) is for reference only.
	   (2026-10, web parity: "Public facilities reporting Typhoid" was removed here.) */
	$t6=[]; $t6_facilities=[]; $t6_any_facilities=[]; $t6_all_facilities=[]; $t6_eligible=[];
	$t6[]=['Block Name','Facility Name','Details (months with Held>Planned)', 'Totals (months with both reported)'];
	if($iSessP!==null && $iSessH!==null){
		foreach($facFiltered as $key=>$fd){
			$parts=[]; $sumP=0; $sumH=0; $hitCount=0; $evaluable=0;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$P = ($md && isset($md['vals'][$iSessP])) ? $md['vals'][$iSessP] : null;
				$H = ($md && isset($md['vals'][$iSessH])) ? $md['vals'][$iSessH] : null;
				if($P===null || $H===null) continue;
				$evaluable++;
				$sumP+=$P; $sumH+=$H;
				if($H>$P){
					$hitCount++;
					$hlCells('t6', $md, [$iSessP, $iSessH]);
					$parts[] = ($P>0) ? $md['label'].' +'.round(($H-$P)/$P*100,1).'%' : $md['label'].' (Planned 0, Held '.round($H).')';
				}
			}
			if($evaluable > 0) $t6_eligible[$key] = true;
			if($hitCount > 0){
				if($sumH>$sumP) $tot = ($sumP>0) ? 'All months +'.round((($sumH-$sumP)/$sumP*100),1).'%' : 'All months (Planned 0, Held '.round($sumH).')';
				else $tot = 'All months: planned '.round($sumP).', held '.round($sumH);
				$t6_facilities[$key]=true;
				if($hitCount === $evaluable) $t6_all_facilities[$key]=true;
				else $t6_any_facilities[$key]=true;
				$t6[] = [display_block_label($fd['block']),$fd['facility'], implode('; ',$parts), $tot];
			}
		}
	}

	/* Outliers (changed 2026-10, web parity): calendar-adjacent months only, a rise from 0 to
	   10 or more = extreme, small-count bands, a pair with an all-zero month (t0) skipped -
	   dqa_eval_outliers(). The screen uses the ticked Key / Additional Indicators and
	   buckets; the Overall Score always uses the standard check (see Overall Score data). */
	$incBucketsSel = array_fill_keys((array)$filters['outliers_inc'], true);
	$dropBucketsSel= array_fill_keys((array)$filters['outliers_drop'], true);
	$outBands = $incBucketsSel + $dropBucketsSel;

	$selVaxList = array_values(array_unique(array_merge(
		isset($filters['outliers_vax']) ? (array)$filters['outliers_vax'] : [],
		isset($filters['add_vax']) ? (array)$filters['add_vax'] : []
	)));
	$idxByShortLocal = $idxByShortAll;
	$tmp = [];
	foreach($selVaxList as $vx){ if(isset($idxByShortLocal[$vx])) $tmp[] = $vx; }
	if(empty($tmp)){ foreach($STD_OUT_VAX as $vx){ if(isset($idxByShortLocal[$vx])) $tmp[] = $vx; } }
	$selVaxList = $tmp;
	$outVaxCols = [];
	foreach($selVaxList as $vx){ $outVaxCols[$vx] = $idxByShortLocal[$vx]; }

	$pairList = [];
	for($i=0;$i<count($selMonthKeysOrdered)-1;$i++){
		$m1 = $selMonthKeysOrdered[$i];
		$m2 = $selMonthKeysOrdered[$i+1];
		if(!dqa_months_adjacent($m1, $m2)) continue; /* e.g. Jan -> Mar (Feb not selected) is not a month-on-month change */
		$pairList[] = [
			'k'=>$m1.'|'.$m2,
			'm1'=>$m1,'m2'=>$m2,
			'm1lbl'=> isset($selMonthLabelsOrdered[$m1]) ? $selMonthLabelsOrdered[$m1] : $m1,
			'm2lbl'=> isset($selMonthLabelsOrdered[$m2]) ? $selMonthLabelsOrdered[$m2] : $m2,
		];
	}

	$t3Res = dqa_eval_outliers($facFiltered, $outVaxCols, $pairList, $t0Hit, $outBands, function($md, $ci) use ($hlCells){ $hlCells('t3', $md, [$ci]); });
	$t3_facilities = $t3Res['flagged'];
	$t3_any_facilities = $t3Res['any'];
	$t3_all_facilities = $t3Res['all'];
	$t3_eligible = $t3Res['eligible'];
	$t3_rows_map = $t3Res['rows'];
	$_SESSION['pink_outlier_hits'] = $t3Res['hitMap'];

	/* Top-3 indicators for Outliers (facilities with a hit) */
	$outAnyCounts = $t3Res['vxAny'];
	$outAllCounts = $t3Res['vxAll'];
	$outOverallCounts = $outAnyCounts;
	arsort($outOverallCounts);
	$top3OutOverall = [];
	foreach($outOverallCounts as $vx=>$cnt){ if($cnt<=0) continue; $top3OutOverall[] = $vx.' ('.$cnt.')'; if(count($top3OutOverall)===3) break; }

	/* export to match the Outliers table */
	$t3_export = [];
	$t3_export_header = ['Block Name','Facility Name'];
	foreach($selVaxList as $vx){
		foreach($pairList as $p){
			$t3_export_header[] = $vx.' '.$p['m1lbl'];
			$t3_export_header[] = $vx.' '.$p['m2lbl'];
			$t3_export_header[] = $vx.' % Change ('.$p['m1lbl'].'–'.$p['m2lbl'].')';
		}
	}
	$t3_export[] = $t3_export_header;
	foreach($t3_rows_map as $row){
		$line = [$row['block'],$row['facility']];
		foreach($selVaxList as $vx){
			foreach($pairList as $p){
				$cell = isset($row['cells'][$vx][$p['k']]) ? $row['cells'][$vx][$p['k']] : null;
				if(!$cell){ $line[] = ''; $line[] = ''; $line[] = ''; continue; }
				$line[] = ($cell['a']===null?'':round($cell['a']));
				$line[] = ($cell['b']===null?'':round($cell['b']));
				$line[] = !empty($cell['fromZero']) ? 'from 0' : (($cell['pct']>0?'+':'').round($cell['pct'],1).'%');
			}
		}
		$t3_export[] = $line;
	}

	/* Dropouts (changed 2026-10, web parity): judged on the period dropout over the selected
	   months in which both doses are reported (monthly values are shown for reference) -
	   dqa_eval_dropouts(). Not computed when fewer than 2 months are selected: one month's
	   doses are mostly different children. */
	$selDropRanges = array_fill_keys((array)$filters['drop_ranges'], true);

	$selectedPairs = [];
	foreach((array)$filters['drop_pairs'] as $pr){
		$pr = trim((string)$pr);
		if($pr!=='') $selectedPairs[$pr]=true;
	}
	/* build pairs from pair-builder rows (index-wise pairing) */
	$fromList = isset($filters['drop_from']) ? (array)$filters['drop_from'] : [];
	$toList = isset($filters['drop_to']) ? (array)$filters['drop_to'] : [];
	$maxN = max(count($fromList), count($toList));
	for($ii=0;$ii<$maxN;$ii++){
		$f = isset($fromList[$ii]) ? trim((string)$fromList[$ii]) : '';
		$t = isset($toList[$ii]) ? trim((string)$toList[$ii]) : '';
		if($f==='' || $t==='') continue;
		if($f === $t) continue;
		$selectedPairs[$f.'→'.$t] = true;
	}
	$selectedPairs = (count($selMonthKeysOrdered) >= 2) ? array_keys($selectedPairs) : [];

	$drop_pair_map = [];
	$drop_tables = [];
	$drop_exports = [];
	$drop_fac_sets = [];
	$drop_hit_map = [];
	$drop_any_sets = [];
	$drop_all_sets = [];
	$drop_eligible = [];

	foreach($selectedPairs as $pairLabel){
		$parts = explode('→',$pairLabel);
		if(count($parts)!=2) continue;
		$from = trim($parts[0]);
		$to = trim($parts[1]);
		if($from==='' || $to==='') continue;
		if(!isset($idxByShortLocal[$from]) || !isset($idxByShortLocal[$to])) continue;

		$pairKey = 'drop_'.safe_key($from.'_'.$to);
		$drop_pair_map[$pairKey] = ['label'=>$pairLabel,'from'=>$from,'to'=>$to];
		$iFrom = $idxByShortLocal[$from];
		$iTo = $idxByShortLocal[$to];
		$dRes = dqa_eval_dropouts($facFiltered, $selMonthKeysOrdered, $iFrom, $iTo, $selDropRanges,
			function($md) use ($hlCells, $pairKey, $iFrom, $iTo){ $hlCells($pairKey, $md, [$iFrom, $iTo]); });

		$web = [
			'pairLabel'=>$pairLabel,
			'from'=>$from,'to'=>$to,
			'months'=>$selMonthKeysOrdered,
			'monthLabels'=>$selMonthLabelsOrdered,
			'rows'=>$dRes['rows']
		];

		$exp = [];
		$expHeader = ['Block Name','Facility Name'];
		foreach($selMonthKeysOrdered as $mk){
			$ml = isset($selMonthLabelsOrdered[$mk]) ? $selMonthLabelsOrdered[$mk] : $mk;
			$expHeader[] = $ml.' '.$from;
			$expHeader[] = $ml.' '.$to;
			$expHeader[] = $ml.' % change';
		}
		$expHeader[] = 'All months '.$from;
		$expHeader[] = 'All months '.$to;
		$expHeader[] = 'All months % change';
		$exp[] = $expHeader;
		foreach($dRes['rows'] as $row){
			$line = [$row['block'],$row['facility']];
			foreach($selMonthKeysOrdered as $mk){
				$cell = $row['cells'][$mk];
				$line[] = ($cell['from']===null?'':round($cell['from']));
				$line[] = ($cell['to']===null?'':round($cell['to']));
				$line[] = ($cell['pct']===null?'':round($cell['pct'],1).'%');
			}
			$line[] = round($row['all']['from']);
			$line[] = round($row['all']['to']);
			$line[] = round($row['all']['pct'],1).'%';
			$exp[] = $line;
		}

		$drop_tables[$pairKey] = $web;
		$drop_exports[$pairKey]= $exp;
		$drop_fac_sets[$pairKey]= $dRes['flagged'];
		$drop_any_sets[$pairKey] = $dRes['any'];
		$drop_all_sets[$pairKey] = $dRes['all'];
		$drop_eligible[$pairKey] = $dRes['eligible'];
		$drop_hit_map[$pairKey]= $dRes['hitSet'];
	}

	$_SESSION['drop_pair_map'] = $drop_pair_map;
	$_SESSION['pink_dropout_hits'] = $drop_hit_map;

	/* Inconsistencies between doses (changed 2026-10, web parity): Penta3>Penta1 and MR2>MR1
	   (MR2>MR1 replaced OPV3>OPV1; FIC>MR1 was removed). Totals over the selected months in
	   which both doses are reported (a blank month is left out of both totals); flagged only
	   when the later dose is higher by more than 25% (50% when both totals are under 10; from
	   0 only when the later total is 10 or more) - dqa_later_dose_exceeds(). The highlighted
	   download marks the cells of exactly those months. */
	$dqa_dose_order = function($iEarlier, $iLater, $dlKey) use ($facFiltered, $selMonthKeysOrdered, $hlCells){
		$r = ['flagged'=>[], 'eligible'=>[], 'any'=>[], 'all'=>[], 'rows'=>[]];
		if($iEarlier===null || $iLater===null) return $r;
		foreach($facFiltered as $key=>$fd){
			$sumE = 0; $sumL = 0; $n = 0; $mHit = 0; $mds = [];
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$e = ($md && isset($md['vals'][$iEarlier])) ? $md['vals'][$iEarlier] : null;
				$l = ($md && isset($md['vals'][$iLater])) ? $md['vals'][$iLater] : null;
				if($e===null || $l===null) continue;
				$sumE += $e; $sumL += $l; $n++; $mds[] = $md;
				if(dqa_later_dose_exceeds($e, $l)) $mHit++;
			}
			if($n === 0) continue;
			$r['eligible'][$key] = true;
			if(!dqa_later_dose_exceeds($sumE, $sumL)) continue;
			$r['flagged'][$key] = true;
			if($mHit === $n) $r['all'][$key] = true; else $r['any'][$key] = true;
			foreach($mds as $md){ $hlCells($dlKey, $md, [$iEarlier, $iLater]); }
			$r['rows'][] = [display_block_label($fd['block']), $fd['facility'], round($sumL), round($sumE), dqa_dose_excess_label($sumE, $sumL)];
		}
		return $r;
	};
	$i1Res = $dqa_dose_order($iP1, $iP3, 't5_p3gtp1');
	$i2Res = $dqa_dose_order($iMR1, $iMR2, 't5_mr2gtmr1');
	$t5_sets = ['p3gtp1'=>$i1Res['flagged'], 'mr2gtmr1'=>$i2Res['flagged']];
	$t5_p3gtp1 = array_merge([['Block Name','Facility Name','Penta3 (total)','Penta1 (total)','% change']], $i1Res['rows']);
	$t5_mr2gtmr1 = array_merge([['Block Name','Facility Name','MR2 (total)','MR1 (total)','% change']], $i2Res['rows']);

	/* additional Inconsistencies pairs (screen only, not scored): same rule */
	$incons_pair_map = [];            // downloadKey => ['from'=>..,'to'=>..,'label'=>..,'pid'=>..]
	$incons_tables = [];              // pid => rows
	$incons_fac_sets = [];            // pid => facilitySet
	$incons_export_map = [];          // downloadKey => rows
	$incons_res = [];                 // pid => flagged / eligible / any / all sets

	$existingPairSet = [];
	$existingPairSet['Penta1→Penta3'] = true; // maps to Penta3>Penta1
	$existingPairSet['MR1→MR2'] = true;       // maps to MR2>MR1

	$fromIn = isset($filters['incons_from']) ? (array)$filters['incons_from'] : [];
	$toIn   = isset($filters['incons_to']) ? (array)$filters['incons_to'] : [];
	$maxI = max(count($fromIn), count($toIn));

	$addedPairs = [];
	for($ii=0;$ii<$maxI;$ii++){
		$f = isset($fromIn[$ii]) ? trim((string)$fromIn[$ii]) : '';
		$t = isset($toIn[$ii]) ? trim((string)$toIn[$ii]) : '';
		if($f==='' || $t==='') continue;
		if($f === $t) continue;
		$pairKeyText = $f.'→'.$t;
		if(isset($existingPairSet[$pairKeyText])) continue;
		$addedPairs[$pairKeyText] = true;
	}

	foreach(array_keys($addedPairs) as $pairKeyText){
		$parts = explode('→', $pairKeyText);
		if(count($parts)!==2) continue;
		$from = trim($parts[0]);
		$to = trim($parts[1]);
		if($from==='' || $to==='') continue;
		if(!isset($idxByShortLocal[$from]) || !isset($idxByShortLocal[$to])) continue;

		$pid = 'iadd_'.safe_key($to.'_gt_'.$from);
		$downloadKey = 't5_'.safe_key($to.'_gt_'.$from);
		$labelName = 'Inconsistencies — '.$to.'>'.$from;

		$res = $dqa_dose_order($idxByShortLocal[$from], $idxByShortLocal[$to], $downloadKey);
		$tbl = array_merge([['Block Name','Facility Name', $to.' (total)', $from.' (total)', '% change']], $res['rows']);

		$incons_tables[$pid] = $tbl;
		$incons_fac_sets[$pid] = $res['flagged'];
		$incons_res[$pid] = $res;
		$incons_export_map[$downloadKey] = $tbl;
		$incons_pair_map[$downloadKey] = ['from'=>$from, 'to'=>$to, 'label'=>$labelName, 'pid'=>$pid];
	}

	$_SESSION['incons_pair_map'] = $incons_pair_map;

	/* Co-admin */
	$coSpecs = [
		'co1'=>['OPV1'=>$iO1,'Penta1'=>$iP1,'RVV1'=>$iRVV1,'PCV1'=>$iPCV1,'fIPV1'=>$ifIPV1],
		'co2'=>['OPV2'=>$iO2,'Penta2'=>$iP2,'RVV2'=>$iRVV2],
		'co3'=>['OPV3'=>$iO3,'Penta3'=>$iP3,'RVV3'=>$iRVV3,'PCV2'=>$iPCV2,'fIPV2'=>$ifIPV2],
		'co4'=>['MR1'=>$iMR1,'PCV Booster'=>$iPCVB,'fIPV3'=>$ifIPV3],
		'co5'=>['MR2'=>$iMR2,'DPT 1st Booster'=>$iDPTB],
	];

	$coTables = [];
	$coExports = [];
	$coFacilities = [];
	$coAnySets = [];
	$coAllSets = [];
	$coEligible = [];
	foreach($coSpecs as $coKey=>$spec){
		$vaxList = array_keys($spec);
		$web = ['key'=>$coKey, 'vaccines'=>$vaxList, 'months'=>$selMonthKeysOrdered, 'monthLabels'=>$selMonthLabelsOrdered, 'rows'=>[]];
		$exp = [];
		$expHeader = ['Block Name','Facility Name'];
		foreach($selMonthKeysOrdered as $mk){
			foreach($vaxList as $vx){ $expHeader[] = (isset($selMonthLabelsOrdered[$mk])?$selMonthLabelsOrdered[$mk]:$mk).' '.$vx; }
		}
		foreach($vaxList as $vx){ $expHeader[] = 'All months '.$vx; }
		$exp[] = $expHeader;

		/* (changed 2026-10, web parity) judged month by month: a month can be checked when 2 or
		   more values of the group are reported, and is flagged when a value is more than 25%
		   from the visit's reference count (50% when the reference is under 10) -
		   dqa_coadmin_out_of_range(). Those values are pink in the table and are the cells
		   marked in the highlighted download. Blank cells are never compared or read as 0.
		   "All months" totals (months where every reported vaccine is present) = reference only. */
		$set = [];
		$coAnySets[$coKey] = []; $coAllSets[$coKey] = []; $coEligible[$coKey] = [];
		foreach($facFiltered as $fkey=>$fd){
			$rowVals = [];
			$rowOdd = [];
			$monthViolCount = 0; $evaluable = 0;

			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$valsMonth = []; $present = 0;
				foreach($spec as $vx=>$idx){
					$val = ($idx!==null && $md && isset($md['vals'][$idx])) ? $md['vals'][$idx] : null;
					$rowVals[$mk][$vx] = $val;
					$valsMonth[$vx] = $val;
					if($val!==null) $present++;
				}
				if($present >= 2) $evaluable++;
				$odd = dqa_coadmin_out_of_range($valsMonth);
				if(!empty($odd)){
					$monthViolCount++;
					$dqa_mask = 0; /* out-of-range vaccines of the month as a bit mask (position in the group) */
					foreach($vaxList as $dqa_vi=>$dqa_vx){ if(isset($odd[$dqa_vx])) $dqa_mask |= (1 << $dqa_vi); }
					$rowOdd[$mk] = $dqa_mask;
					$oddCols = [];
					foreach($odd as $vx=>$on){ $oddCols[] = $spec[$vx]; }
					$hlCells($coKey, $md, $oddCols);
				}
			}

			if($evaluable > 0) $coEligible[$coKey][$fkey] = true;
			if($monthViolCount > 0){
				$set[$fkey]=true;
				if($monthViolCount === $evaluable) $coAllSets[$coKey][$fkey]=true;
				else $coAnySets[$coKey][$fkey]=true;
				$totals = dqa_coadmin_matched_totals($rowVals, $vaxList);
				$web['rows'][$fkey]=['block'=>display_block_label($fd['block']), 'facility'=>$fd['facility'], 'vals'=>$rowVals, 'odd'=>$rowOdd, 'totals'=>$totals];
				$line = [display_block_label($fd['block']),$fd['facility']];
				foreach($selMonthKeysOrdered as $mk){
					foreach($vaxList as $vx){
						$v = $rowVals[$mk][$vx];
						$line[] = ($v===null?'':round($v));
					}
				}
				foreach($vaxList as $vx){ $line[] = ($totals[$vx]===null ? '' : round($totals[$vx])); }
				$exp[]=$line;
			}
		}

		$coTables[$coKey]=$web;
		$coExports[$coKey]=$exp;
		$coFacilities[$coKey]=$set;
	}

	/* Charts counts */
	$chartCounts = function($facSet) use($facFiltered){
		$counts=[];
		foreach($facSet as $key=>$_){
			$blockRaw = isset($facFiltered[$key]) ? $facFiltered[$key]['block'] : '';
			$block = display_block_label($blockRaw);
			$counts[$block]=isset($counts[$block]) ? $counts[$block]+1 : 1;
		}
		ksort($counts, SORT_NATURAL|SORT_FLAG_CASE);
		return $counts;
	};

	$cT1 = $chartCounts($t1_facilities);
	$cT0 = $chartCounts($t0_facilities);
	$cT7 = $chartCounts($t7_facilities);
	$cT10 = $chartCounts($t10_facilities); /* (added 2026-10) */
	$cT2 = $chartCounts($t2_facilities);
	$cS6 = $chartCounts($t6_facilities);
	$cT3 = $chartCounts($t3_facilities);
	$cI1 = $chartCounts($t5_sets['p3gtp1']);
	$cI2 = $chartCounts($t5_sets['mr2gtmr1']); /* (changed 2026-10) MR2>MR1 */

	$cInconsExtra = []; // pid => counts
	foreach($incons_fac_sets as $pid=>$set){ $cInconsExtra[$pid] = $chartCounts($set); }

	$cCo = [];
	foreach($coFacilities as $k=>$set){ $cCo[$k] = $chartCounts($set); }

	$cDrop = [];
	foreach($drop_fac_sets as $k=>$set){ $cDrop[$k] = $chartCounts($set); }

	/* KPI counts: flagged facilities ('total'), Any / All months and (added 2026-10) the
	   facilities the check could be evaluated for ('eligible'): a check with none cannot be
	   run and passes its weight on in the Overall Score */
	$kpiCount = function($facSet, $anySet=null, $allSet=null, $eligibleSet=null){
		$any = ($anySet===null) ? count($facSet) : count($anySet);
		$all = ($allSet===null) ? 0 : count($allSet);
		return ['total'=>count($facSet),'any'=>$any,'all'=>$all,'eligible'=>($eligibleSet===null ? 0 : count($eligibleSet))];
	};

	$kpi = [
		't1' => $kpiCount($t1_facilities, $t1_any_facilities, $t1_all_facilities, $t1_eligible),
		't0' => $kpiCount($t0_facilities, $t0_any_facilities, $t0_all_facilities, $t0_eligible),
		't7' => $kpiCount($t7_facilities, $t7_any_facilities, $t7_all_facilities, $t7_eligible),
		't10' => $kpiCount($t10_facilities, $t10_any_facilities, $t10_all_facilities, $t10_eligible),
		't2' => $kpiCount($t2_facilities, $t2_any_facilities, $t2_all_facilities, $t2_eligible),
		't6' => $kpiCount($t6_facilities, $t6_any_facilities, $t6_all_facilities, $t6_eligible),
		't3' => $kpiCount($t3_facilities, $t3_any_facilities, $t3_all_facilities, $t3_eligible),
		'i1' => $kpiCount($i1Res['flagged'], $i1Res['any'], $i1Res['all'], $i1Res['eligible']),
		'i2' => $kpiCount($i2Res['flagged'], $i2Res['any'], $i2Res['all'], $i2Res['eligible']),
	];
	foreach(array_keys($coSpecs) as $coKey){
		$kpi[$coKey] = $kpiCount($coFacilities[$coKey], $coAnySets[$coKey], $coAllSets[$coKey], $coEligible[$coKey]);
	}
	foreach($drop_fac_sets as $k=>$set){
		$kpi[$k] = $kpiCount($set, $drop_any_sets[$k], $drop_all_sets[$k], $drop_eligible[$k]);
	}
	foreach($incons_res as $pid=>$res){ $kpi[$pid] = $kpiCount($res['flagged'], $res['any'], $res['all'], $res['eligible']); }

	/* Summary tables (Indicator / Facilities / %) for each KPI) */
	$summaryByPid = [];
	$summaryTotalDen = (int)$selDen; /* (changed 2026-10) facilities under the current selection */

	$mkRow = function($name,$cnt) use ($summaryTotalDen){
		$cnt = (int)$cnt;
		$pct = ($summaryTotalDen>0) ? round(($cnt/$summaryTotalDen)*100, 2) : 0;
		return ['name'=>$name,'count'=>$cnt,'pct'=>$pct];
	};

	// Availability KPIs (single row)
	$summaryByPid['t1'] = ['any'=>[$mkRow('All Indicators Blank', $kpi['t1']['any'])], 'all'=>[$mkRow('All Indicators Blank', $kpi['t1']['all'])]];
	$summaryByPid['t0'] = ['any'=>[$mkRow('Indicators having 0 values but not blank', $kpi['t0']['any'])], 'all'=>[$mkRow('Indicators having 0 values but not blank', $kpi['t0']['all'])]];
	$summaryByPid['t7'] = ['any'=>[$mkRow('Duplicate Monthly Record', $kpi['t7']['any'])], 'all'=>[$mkRow('Duplicate Monthly Record', $kpi['t7']['all'])]];
	$summaryByPid['t10'] = ['any'=>[$mkRow('Session Not Held but Vaccinated', $kpi['t10']['any'])], 'all'=>[$mkRow('Session Not Held but Vaccinated', $kpi['t10']['all'])], 'overall'=>[$mkRow('Session Not Held but Vaccinated', $kpi['t10']['total'])]];

	// Completeness summary per item
	if(isset($blankCountsByVax) && is_array($blankCountsByVax)){
		$anyRows=[]; $allRows=[]; $overallRows=[];
		foreach($blankCountsByVax as $vx=>$cnt){
			$allCnt = isset($blankAllCountsByVax[$vx]) ? (int)$blankAllCountsByVax[$vx] : 0;
			$overallCnt = (int)$cnt;
			$anyCnt = max(0, $overallCnt - $allCnt);
			$anyRows[] = $mkRow($vx,$anyCnt);
			$allRows[] = $mkRow($vx,$allCnt);
			$overallRows[] = $mkRow($vx,$overallCnt);
		}
		usort($anyRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		usort($allRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		usort($overallRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		$summaryByPid['t2'] = ['any'=>$anyRows,'all'=>$allRows,'overall'=>$overallRows];
	}

	// Outliers summary per indicator
	if(isset($outAnyCounts) && is_array($outAnyCounts)){
		$overallRows=[];
		foreach($outAnyCounts as $vx=>$cnt){ $overallRows[] = $mkRow($vx,(int)$cnt); }
		usort($overallRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		$summaryByPid['t3'] = ['overall'=>$overallRows];
	}

	// Sessions Held > Sessions Planned summary (single row)
	$summaryByPid['t6'] = ['any'=>[$mkRow('Sessions Held > Sessions Planned', $kpi['t6']['any'])], 'all'=>[$mkRow('Sessions Held > Sessions Planned', $kpi['t6']['all'])], 'overall'=>[$mkRow('Sessions Held > Sessions Planned', $kpi['t6']['total'])]];

	// Dropouts and Inconsistencies (single row per KPI)
	foreach($drop_fac_sets as $k=>$set){
		$pairName = isset($drop_pair_map[$k]) ? $drop_pair_map[$k]['label'] : $k; /* (fixed) e.g. Penta1→Penta3 */
		$summaryByPid[$k] = ['any'=>[$mkRow($pairName, $kpi[$k]['any'])], 'all'=>[$mkRow($pairName, $kpi[$k]['all'])], 'overall'=>[$mkRow($pairName, $kpi[$k]['total'])]];
	}
	$summaryByPid['i1'] = ['any'=>[$mkRow('Penta3>Penta1', $kpi['i1']['total'])], 'all'=>[]];
	$summaryByPid['i2'] = ['any'=>[$mkRow('MR2>MR1', $kpi['i2']['total'])], 'all'=>[]];

	/* Cards list (changed 2026-10, web parity: same checks, names, order and components as the
	   web application; Sessions Held > Planned is scored under Consistency) */
	$sessAvailable = ($iSessP!==null && $iSessH!==null); /* shown only when both session columns exist */
	$cardsList = [];
	$cardsList[] = ['id'=>'t1','name'=>'All Indicators Blank','stat'=>$kpi['t1'],'group'=>'availability','downloadKey'=>'t1'];
	$cardsList[] = ['id'=>'t0','name'=>'Indicators having 0 values but not blank','stat'=>$kpi['t0'],'group'=>'availability','downloadKey'=>'t0'];
	$cardsList[] = ['id'=>'t7','name'=>'Duplicate Monthly Record','stat'=>$kpi['t7'],'group'=>'availability','downloadKey'=>'t7'];
	if($t10Available){ $cardsList[] = ['id'=>'t10','name'=>'Session Not Held but Vaccinated','stat'=>$kpi['t10'],'group'=>'availability','downloadKey'=>'t10']; }
	$cardsList[] = ['id'=>'t2','name'=>'Key Missing Indicators','stat'=>$kpi['t2'],'group'=>'completeness','downloadKey'=>'t2'];
	if($sessAvailable){ $cardsList[] = ['id'=>'t6','name'=>'Sessions Held > Sessions Planned','stat'=>$kpi['t6'],'group'=>'consistency','downloadKey'=>'t6']; }
	$cardsList[] = ['id'=>'t3','name'=>'Outliers','stat'=>$kpi['t3'],'group'=>'accuracy','downloadKey'=>'t3'];

	foreach($drop_pair_map as $dk=>$pm){
		$cardsList[] = ['id'=>$dk,'name'=>'Dropouts — '.$pm['label'],'stat'=>$kpi[$dk],'group'=>'accuracy','downloadKey'=>$dk];
	}

	$cardsList[] = ['id'=>'i1','name'=>'Inconsistencies — Penta3>Penta1','stat'=>$kpi['i1'],'group'=>'consistency','downloadKey'=>'t5_p3gtp1'];
	$cardsList[] = ['id'=>'i2','name'=>'Inconsistencies — MR2>MR1','stat'=>$kpi['i2'],'group'=>'consistency','downloadKey'=>'t5_mr2gtmr1'];

	/* dynamic inconsistencies KPI cards (screen only, not scored) */
	foreach($incons_pair_map as $dlKey=>$meta){
		$pid = $meta['pid'];
		$cardsList[] = ['id'=>$pid,'name'=>$meta['label'],'stat'=>$kpi[$pid],'group'=>'consistency','downloadKey'=>$dlKey];
	}

	$cardsList[] = ['id'=>'co1','name'=>'6 weeks — OPV1, Penta1, RVV1, PCV1, fIPV1','stat'=>$kpi['co1'],'group'=>'consistency','downloadKey'=>'co1'];
	$cardsList[] = ['id'=>'co2','name'=>'10 weeks — OPV2, Penta2, RVV2','stat'=>$kpi['co2'],'group'=>'consistency','downloadKey'=>'co2'];
	$cardsList[] = ['id'=>'co3','name'=>'14 weeks — OPV3, Penta3, RVV3, PCV2, fIPV2','stat'=>$kpi['co3'],'group'=>'consistency','downloadKey'=>'co3'];
	$cardsList[] = ['id'=>'co4','name'=>'9 months — MR1, PCV Booster, fIPV3','stat'=>$kpi['co4'],'group'=>'consistency','downloadKey'=>'co4'];
	$cardsList[] = ['id'=>'co5','name'=>'2 years — MR2, DPT 1st Booster','stat'=>$kpi['co5'],'group'=>'consistency','downloadKey'=>'co5'];

	/* Charts payload */
	$groupColor = [
		'availability'=>'#0ea5e9',
		'completeness'=>'#6366f1',
		'accuracy'=>'#f97316',
		'consistency'=>'#22c55e'
	];
	/* NEW: light green for inconsistencies charts (matches KPI card light green) */
	$inconsLight = '#86efac';

	$charts = [
		't1'=>['labels'=>array_keys($cT1),'values'=>array_values($cT1),'color'=>$groupColor['availability']],
		't0'=>['labels'=>array_keys($cT0),'values'=>array_values($cT0),'color'=>$groupColor['availability']],
		't7'=>['labels'=>array_keys($cT7),'values'=>array_values($cT7),'color'=>$groupColor['availability']],
		't10'=>['labels'=>array_keys($cT10),'values'=>array_values($cT10),'color'=>$groupColor['availability']], /* (added 2026-10) */
		't2'=>['labels'=>array_keys($cT2),'values'=>array_values($cT2),'color'=>$groupColor['completeness']],
		't6'=>['labels'=>array_keys($cS6),'values'=>array_values($cS6),'color'=>$inconsLight], /* (changed 2026-10) Consistency */
		't3'=>['labels'=>array_keys($cT3),'values'=>array_values($cT3),'color'=>$groupColor['accuracy']],
		/* CHANGED: i1/i2 charts light green */
		'i1'=>['labels'=>array_keys($cI1),'values'=>array_values($cI1),'color'=>$inconsLight],
		'i2'=>['labels'=>array_keys($cI2),'values'=>array_values($cI2),'color'=>$inconsLight],
		'co1'=>['labels'=>array_keys($cCo['co1']),'values'=>array_values($cCo['co1']),'color'=>$groupColor['consistency']],
		'co2'=>['labels'=>array_keys($cCo['co2']),'values'=>array_values($cCo['co2']),'color'=>$groupColor['consistency']],
		'co3'=>['labels'=>array_keys($cCo['co3']),'values'=>array_values($cCo['co3']),'color'=>$groupColor['consistency']],
		'co4'=>['labels'=>array_keys($cCo['co4']),'values'=>array_values($cCo['co4']),'color'=>$groupColor['consistency']],
		'co5'=>['labels'=>array_keys($cCo['co5']),'values'=>array_values($cCo['co5']),'color'=>$groupColor['consistency']],
	];

	foreach($drop_pair_map as $dk=>$pm){
		$charts[$dk] = ['labels'=>array_keys($cDrop[$dk]),'values'=>array_values($cDrop[$dk]),'color'=>$groupColor['accuracy']];
	}

	/* NEW: charts for dynamic inconsistencies (light green) */
	foreach($incons_pair_map as $dlKey=>$meta){
		$pid = $meta['pid'];
		$counts = isset($cInconsExtra[$pid]) ? $cInconsExtra[$pid] : [];
		$charts[$pid] = ['labels'=>array_keys($counts),'values'=>array_values($counts),'color'=>$inconsLight];
	}

	/* Export store */
	$_SESSION['dqa_hl'] = $HL; /* (added 2026-10) cells for "Actual data with highlighted cells" */
	$_SESSION['dqa_render_id'] = dqa_new_upload_id(); /* (added 2026-10) this page's id: its highlighted-download links carry it */
	$_SESSION['exports'] = [];
	$_SESSION['exports']['t1'] = ['label'=>'All_indicators_blank_matrix','rows'=>$t1];
	$_SESSION['exports']['t0'] = ['label'=>'Indicators_0_not_blank_matrix','rows'=>$t0];
	$_SESSION['exports']['t7'] = ['label'=>'Duplicate_Monthly_Record_matrix','rows'=>$t7];
	$_SESSION['exports']['t10'] = ['label'=>'Session_Not_Held_but_Vaccinated','rows'=>$t10];
	$_SESSION['exports']['t2'] = ['label'=>'Missing_Indicator_matrix','rows'=>$t2];
	$_SESSION['exports']['t6'] = ['label'=>'Sessions_Held_gt_Planned','rows'=>$t6];
	$_SESSION['exports']['t3'] = ['label'=>'Outliers_matrix','rows'=>$t3_export];
	$_SESSION['exports']['t5_p3gtp1'] = ['label'=>'Inconsistencies_Penta3_gt_Penta1','rows'=>$t5_p3gtp1];
	$_SESSION['exports']['t5_mr2gtmr1'] = ['label'=>'Inconsistencies_MR2_gt_MR1','rows'=>$t5_mr2gtmr1];

	/* NEW: dynamic inconsistencies exports */
	foreach($incons_export_map as $dlKey=>$rowsExp){
		$_SESSION['exports'][$dlKey] = ['label'=>$dlKey,'rows'=>$rowsExp];
	}

	foreach($coExports as $ck=>$rowsExp){
		$_SESSION['exports'][$ck] = ['label'=>strtoupper($ck).'_CoAdmin_matrix','rows'=>$rowsExp];
	}
	foreach($drop_exports as $dk=>$rowsExp){
		$_SESSION['exports'][$dk] = ['label'=>'Dropouts_'.$drop_pair_map[$dk]['from'].'_to_'.$drop_pair_map[$dk]['to'],'rows'=>$rowsExp];
	}

	/* Pink facility sets for FULL-FILE export */
	$_SESSION['pink_fac_sets'] = [
		't1' => array_keys($t1_facilities),
		't0' => array_keys($t0_facilities),
		't7' => array_keys($t7_facilities),
		't10' => array_keys($t10_facilities),
		't2' => array_keys($t2_facilities),
		't6' => array_keys($t6_facilities),
		't3' => array_keys($t3_facilities),
		't5_p3gtp1'=> array_keys($t5_sets['p3gtp1']),
		't5_mr2gtmr1'=> array_keys($t5_sets['mr2gtmr1']),
		'co1'=> array_keys($coFacilities['co1']),
		'co2'=> array_keys($coFacilities['co2']),
		'co3'=> array_keys($coFacilities['co3']),
		'co4'=> array_keys($coFacilities['co4']),
		'co5'=> array_keys($coFacilities['co5']),
	];
	foreach($drop_fac_sets as $dk=>$set){ $_SESSION['pink_fac_sets'][$dk] = array_keys($set); }

	/* NEW: dynamic inconsistencies full-file facility sets */
	foreach($incons_pair_map as $dlKey=>$meta){
		$pid = $meta['pid'];
		$_SESSION['pink_fac_sets'][$dlKey] = array_keys(isset($incons_fac_sets[$pid]) ? $incons_fac_sets[$pid] : []);
	}

	$initGroup = $filters['active_group'];

	/* Y/N legend texts (Y = no issue, N = issue) shown under each Y/N matrix and its panel box */
	$dqaYnNotes = [
		't1' => "N marks a month in which the facility has no report, or every M9 (Child Immunisation) item is blank.",
		't0' => "N marks a month in which every M9 item of the facility is reported as 0 (not blank). '–' = no report for the month.",
		't7' => "N marks a month whose M9 record is an exact copy of the previous calendar month's record (with at least one value above 0). '–' = could not be compared (first month, previous calendar month not selected, or no report).",
		't2' => "N marks a key M9 item left blank for that month (every M9 item except JE, delayed MR 1st dose and Typhoid). Facilities counted under All Indicators Blank are not checked here.",
	];
	/* short rule notes under the panels whose rule is not a Y/N matrix */
	$dqaInconsNote = "Totals add the selected months in which both doses are reported; a month with a blank value is left out of both totals. Flagged only when the later dose is higher by more than 25% (more than 50% when both totals are under 10; from 0 only when the later total is 10 or more). The highlighted download marks the cells of exactly those months.";
	$dqaCoNote = "A month is counted when two or more values of the group are reported (blank cells are not compared) and a value differs from the visit's reference count by more than 25% (50% when the reference is under 10). Reference = the value repeated most often, otherwise Penta, otherwise MR, otherwise the median. Pink = values out of range. \"All months\" totals are for reference only.";
	$dqaDropNote = "Judged on the totals of the selected months in which both doses are reported (period dropout); the monthly values are for reference. The Overall Score always uses Penta1→Penta3, MR1→MR2 and Penta3→MR1 at 20% or more.";
	$dqaPanelNotes = [
		't6' => "A month is counted when Sessions Planned and Sessions Held are both reported and Held is more than Planned (a blank month is not counted). Totals are for reference only.",
		't10' => "A month is counted when Sessions Held is reported; it is flagged when Sessions Held is 0 while Penta1, Penta3, MR1 or MR2 is above 0 (birth doses are not counted).",
		't3' => "Compares calendar-adjacent months only; a pair with an all-zero month is skipped. Increase: Low 25 to <50%, Moderate 50–100%, Extreme >100% or from 0 to 10+. Decrease: Low −25 to >−50%, Moderate −50 to >−75%, Extreme −75 to −100%. When both values are under 10 the increase bands are doubled and decreases are not flagged. The Overall Score always uses BCG, Penta1, Penta3, MR1 and MR2 with the Extreme buckets.",
		'i1' => $dqaInconsNote, 'i2' => $dqaInconsNote,
		'co1' => $dqaCoNote, 'co2' => $dqaCoNote, 'co3' => $dqaCoNote, 'co4' => $dqaCoNote, 'co5' => $dqaCoNote,
	];
	foreach($incons_pair_map as $dqa_dk=>$dqa_meta){ $dqaPanelNotes[$dqa_meta['pid']] = $dqaInconsNote; }
	foreach($drop_pair_map as $dqa_dk=>$dqa_pm){ $dqaPanelNotes[$dqa_dk] = $dqaDropNote; }
	$t2_web = [
		'title' => $t2Title,
		'vaccines' => $t2Vax,
		'months' => $selMonthKeysOrdered,
		'monthLabels' => $selMonthLabelsOrdered,
		'rows' => $t2_matrix_cache,
		'highlightN' => true,
		'ynNote' => $dqaYnNotes['t2'] /* (added) legend */
	];
	$t3_web = ['vaccines'=>$selVaxList, 'pairs'=>$pairList, 'rows'=>$t3_rows_map, 'highlightN'=>false];

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
				<div><div class="panelTitle"><?=h($c['name'])?></div></div>
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
						if($pid==='t1' || $pid==='t0'){
							render_table(($pid==='t1')?$t1:$t0, true, $dqaYnNotes[$pid]);
						} elseif($pid==='t7'){
							render_table($t7, true, $dqaYnNotes['t7']);
						} elseif($pid==='t10'){ /* (added 2026-10) */
							render_table($t10, false);
						} elseif($pid==='t2'){
							render_missing_indicator_two_level($t2_web);
						} elseif($pid==='t6'){
							render_table($t6, false);
						} elseif($pid==='t3'){
							render_outliers_two_level($t3_web);
						} elseif(str_starts_with($pid,'drop_')){
							if(isset($drop_tables[$pid])) render_dropouts_pair_two_level($drop_tables[$pid]);
							else echo "<div style='padding:12px'>No records.</div>";
						} elseif($pid==='i1'){
							render_table($t5_p3gtp1, false);
						} elseif($pid==='i2'){
							render_table($t5_mr2gtmr1, false); /* (changed 2026-10) MR2>MR1 */
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
							echo '<table class="dataTable"><thead><tr><th>Indicator</th><th>Facilities</th><th>%</th></tr></thead><tbody>';
							foreach($rows as $r){
								echo '<tr><td>'.h($r['name']).'</td><td>'.h((string)$r['count']).'</td><td>'.h((string)$r['pct']).'%</td></tr>';
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
			if($pid === 't6' || $pid === 'i1' || $pid === 'i2' || str_starts_with($pid,'iadd_')){ /* (changed 2026-10) Sessions Held > Planned is a Consistency check */
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
			if($pid === 't6' || $pid === 'i1' || $pid === 'i2' || str_starts_with($pid,'iadd_')) $kind = ' kind-incons';
			else $kind = ' kind-missed';
		}

		$cls = "kpi kpiCard group-".$grp.$kind;
		$cardHtml = '<div class="'.h($cls).'" data-group="'.h($grp).'" data-target="'.h($pid).'" data-total="'.h((string)$totalVal).'">';
		$cardHtml .= '<h3>'.h($c['name']).'</h3>';
		$showSplit = (isset($c['stat']['any']) && isset($c['stat']['all']) && (
			$grp==='availability' || $pid==='t2' || $pid==='t6' || str_starts_with($pid,'drop_') || str_starts_with($pid,'co')
		));

		if($showSplit){
			$anyCnt = (int)$c['stat']['any'];
			$allCnt = (int)$c['stat']['all'];
			$cardHtml .= '<div class="splitTotal"><span class="splitTotalNum">'.h((string)$totalVal).'</span><span class="unit"> facilities</span></div>';
			$cardHtml .= '<div class="split"><div class="splitCol"><div class="splitLbl">Any month</div><div class="splitVal"><span class="splitValNum">'.h((string)$anyCnt).'</span><span class="unit"> facilities</span></div></div><div class="splitCol"><div class="splitLbl">All months</div><div class="splitVal"><span class="splitValNum">'.h((string)$allCnt).'</span><span class="unit"> facilities</span></div></div></div>';

			// add top-3 lists for Completeness and Outliers (kept as-is)
			if($pid==='t2'){
				$cardHtml .= '<div class="top3"><div class="top3Row"><b>Any month:</b> '.h(implode(', ', $top3BlankAny)).'</div><div class="top3Row"><b>All months:</b> '.h(implode(', ', $top3BlankAll)).'</div><div class="top3Row"><b>Overall:</b> '.h(implode(', ', $top3BlankOverall)).'</div></div>';
			}
			if($pid==='t3'){
				$cardHtml .= '<div class="top3"><div class="top3Row">'.h(!empty($top3OutOverall)?implode(', ', $top3OutOverall):'-').'</div></div>';
			}
		} else {
			// Single-number KPI card (no "facilities" text)
			$cardHtml .= '<div class="num">'.h((string)$totalVal).' <span class="unit">facilities</span></div>';
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
	   (changed 2026-10, web parity: scoring method v8 of the DQA web application)
	   - Every standard check has a fixed weight (dqa_weight_table: one table for 1 month,
	     one for 2 or more months); check score = 100 - % of the facilities under the
	     selection that it flags; overall = sum of weight used x check score / 100.
	   - A check no facility could be evaluated for cannot run; its weight passes to its
	     group, then its component, then the other components (dqa_weighted_score).
	   - The score always uses the standard checks - standard outlier vaccines and the
	     Extreme buckets, the 3 standard dropout pairs at 20% or more, no custom pairs -
	     whatever the reviewer ticked, so the same data always gets the same score. The
	     other checks have no method settings, so their screen cards are the score cards.
	   This replaces "component = 100 - worst KPI %, overall = mean of 4 components". */
	$osDen = (int)$selDen; /* facilities under the current selection */
	$scorePeriodCount = count($selMonthKeysOrdered);

	$stdOutCols = [];
	foreach($STD_OUT_VAX as $vx){ if(isset($idxByShortLocal[$vx])) $stdOutCols[$vx] = $idxByShortLocal[$vx]; }
	$t3Std = dqa_eval_outliers($facFiltered, $stdOutCols, $pairList, $t0Hit, ['INC_EXT'=>true, 'DROP_EXT'=>true]);
	$scoreSets = isset($_SESSION['pink_fac_sets']) ? $_SESSION['pink_fac_sets'] : [];
	$scoreSets['t3'] = array_keys($t3Std['flagged']);
	$stdDropCards = [];
	if($scorePeriodCount >= 2){
		foreach($PAIR_DEFAULTS as $dqa_pl){
			$dqa_pp = explode('→', $dqa_pl);
			$dqa_from = trim($dqa_pp[0]); $dqa_to = trim($dqa_pp[1]);
			if(!isset($idxByShortLocal[$dqa_from]) || !isset($idxByShortLocal[$dqa_to])) continue;
			$dqa_dk = 'drop_'.safe_key($dqa_from.'_'.$dqa_to);
			$dqa_dr = dqa_eval_dropouts($facFiltered, $selMonthKeysOrdered, $idxByShortLocal[$dqa_from], $idxByShortLocal[$dqa_to], ['R20P'=>true]);
			$stdDropCards[] = ['id'=>$dqa_dk,'name'=>'Dropouts — '.$dqa_pl,'stat'=>$kpiCount($dqa_dr['flagged'], $dqa_dr['any'], $dqa_dr['all'], $dqa_dr['eligible']),'group'=>'accuracy','downloadKey'=>$dqa_dk];
			$scoreSets[$dqa_dk] = array_keys($dqa_dr['flagged']);
		}
	}
	/* score cards = the screen cards with the standard Outliers / Dropouts; custom pairs left out */
	$scoreCardsList = [];
	foreach($cardsList as $c){
		if(str_starts_with($c['id'],'drop_') || str_starts_with($c['id'],'iadd_')) continue;
		if($c['id']==='t3'){
			$c['stat'] = $kpiCount($t3Std['flagged'], $t3Std['any'], $t3Std['all'], $t3Std['eligible']);
			$scoreCardsList[] = $c;
			foreach($stdDropCards as $dqa_c){ $scoreCardsList[] = $dqa_c; }
			continue;
		}
		$scoreCardsList[] = $c;
	}
	$scoreInput = [];
	foreach($scoreCardsList as $c){ $scoreInput[$c['id']] = ['flagged'=>(int)$c['stat']['total'], 'eligible'=>(int)$c['stat']['eligible'], 'name'=>$c['name']]; }
	$wScore = dqa_weighted_score($scoreInput, $osDen, $scorePeriodCount);

	$osComponents = [
		'availability'=>['name'=>'Availability','kpis'=>[]],
		'completeness'=>['name'=>'Completeness','kpis'=>[]],
		'accuracy'=>['name'=>'Accuracy','kpis'=>[]],
		'consistency'=>['name'=>'Consistency','kpis'=>[]],
	];

	foreach($scoreCardsList as $c){
		$g = $c['group'];
		if(!isset($osComponents[$g])) continue;
		$stat = $c['stat'];
		if($osDen <= 0 || (int)$stat['eligible'] <= 0) continue; /* a check that could not be run is not listed */
		$tot = (int)$stat['total'];
		$any = (int)$stat['any'];
		$all = (int)$stat['all'];
		$osComponents[$g]['kpis'][] = [
			'name'=>$c['name'],
			'total'=>$tot,
			'any'=>$any,
			'all'=>$all,
			'pct'=>$tot*100.0/$osDen,
			'pctAny'=>$any*100.0/$osDen,
			'pctAll'=>$all*100.0/$osDen
		];
	}

	$osMini = [];
	$osScores = [];
	foreach($osComponents as $gid=>$g){
		$kpis = $g['kpis'];
		usort($kpis, function($a,$b){
			if($a['pct']===$b['pct']) return 0;
			return ($a['pct']<$b['pct']) ? 1 : -1;
		});
		$top = ($gid==='consistency') ? array_slice($kpis, 0, 7) : array_slice($kpis, 0, 5);
		$maxAny = 0.0; $maxAll = 0.0; $maxTot = 0.0;
		foreach($kpis as $r){
			if($r['pctAny']>$maxAny) $maxAny=$r['pctAny'];
			if($r['pctAll']>$maxAll) $maxAll=$r['pctAll'];
			if($r['pct']>$maxTot) $maxTot=$r['pct'];
		}
		$score = isset($wScore['components'][$gid]) ? $wScore['components'][$gid] : null; /* null = N/A */
		$osScores[$gid] = $score;

		$osComponents[$gid]['top'] = $top;
		$osComponents[$gid]['maxAny'] = $maxAny;
		$osComponents[$gid]['maxAll'] = $maxAll;
		$osComponents[$gid]['score'] = $score;
		$osComponents[$gid]['weight'] = isset($wScore['componentWeights'][$gid]) ? $wScore['componentWeights'][$gid] : 0;

		$osMini[] = ['id'=>$gid,'name'=>$g['name'],'score'=>$score,'maxTot'=>$maxTot];
	}

	$overallScore = $wScore['overall']; /* null = nothing could be scored (no facility under the selection) */

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
		/* (changed 2026-10) the score always uses the standard checks, so the method settings
		   (outlier / dropout ticks, custom pairs) no longer change it: only the scope is tested */
		$dqa_sc_unfiltered =
			$dqa_sc_same($filters['blocks'], array_keys($allBlocks)) &&
			$dqa_sc_same($filters['months'], array_keys($allMonths)) &&
			$dqa_sc_same($filters['ownership'], array('Public','Private')) &&
			$dqa_sc_same($filters['ru'], array('Rural','Urban'));
		if ($dqa_sc_unfiltered) {
			/* Same database as dqa.php (where dqa_usage_log lives). */
			$DQA_SC_DB_HOST = 'localhost';
			$DQA_SC_DB_NAME = 'epsvdwgx_reviewdatabase';
			$DQA_SC_DB_USER = 'epsvdwgx_mainadmin';
			$DQA_SC_DB_PASS = 'Ramkrishna$1210';
			try {
				/* Period of the uploaded data (ALL uploaded months). */
				$dqa_sc_mkeys = array_values($monthKeys);
				sort($dqa_sc_mkeys, SORT_STRING);
				$dqa_sc_mcount = count($dqa_sc_mkeys);
				$dqa_sc_min = $dqa_sc_mkeys[0];
				$dqa_sc_max = $dqa_sc_mkeys[$dqa_sc_mcount - 1];
				$dqa_sc_span = months_span_inclusive($dqa_sc_min, $dqa_sc_max);
				$dqa_sc_contig = ($dqa_sc_span !== null && (int)$dqa_sc_span === $dqa_sc_mcount) ? 1 : 0;
				if ($dqa_sc_mcount === 1) {
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
				$dqa_sc_key = sha1('dqahmis|' . session_id() . '|' . (int)$dqa_sc_keyid . '|' . (string)$dqa_sc_state . '|' . (string)$dqa_sc_district . '|' . $dqa_sc_period);
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
					':tool_name' => 'dqahmis',
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
					':denominator' => (int)$osDen,
					':s_av' => isset($osScores['availability']) ? round((float)$osScores['availability'], 2) : null,
					':s_co' => isset($osScores['completeness']) ? round((float)$osScores['completeness'], 2) : null,
					':s_ac' => isset($osScores['accuracy']) ? round((float)$osScores['accuracy'], 2) : null,
					':s_cn' => isset($osScores['consistency']) ? round((float)$osScores['consistency'], 2) : null,
					':s_ov' => ($overallScore === null ? null : round((float)$overallScore, 2)),
				));
				$dqa_sc_runid = (int)$dqa_sc_pdo->lastInsertId();
				if ($dqa_sc_runid > 0) {
					$dqa_sc_del = $dqa_sc_pdo->prepare('DELETE FROM dqa_score_kpi WHERE run_id = :rid');
					$dqa_sc_del->execute(array(':rid' => $dqa_sc_runid));
					$dqa_sc_ins = $dqa_sc_pdo->prepare('INSERT INTO dqa_score_kpi
						(run_id, component, kpi_code, kpi_label, numerator, num_any, num_all, denominator, pct, pct_any, pct_all)
						VALUES (:rid, :component, :kpi_code, :kpi_label, :numerator, :num_any, :num_all, :denominator, :pct, :pct_any, :pct_all)');
					foreach ($scoreCardsList as $dqa_sc_c) { /* (changed 2026-10) the checks the score is computed from */
						$dqa_sc_stat = isset($dqa_sc_c['stat']) ? $dqa_sc_c['stat'] : array('total' => 0, 'any' => 0, 'all' => 0);
						$dqa_sc_tot = isset($dqa_sc_stat['total']) ? (int)$dqa_sc_stat['total'] : 0;
						$dqa_sc_any = isset($dqa_sc_stat['any']) ? (int)$dqa_sc_stat['any'] : $dqa_sc_tot;
						$dqa_sc_all = isset($dqa_sc_stat['all']) ? (int)$dqa_sc_stat['all'] : 0;
						$dqa_sc_den = (int)$osDen;
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
	$overallSummaryHtml .=     '<div><div class="osTitle">Overall Score</div><div class="osMeta">'.h($stateName).' · '.h($distName).' · '.h(strip_tags($durationStrHtml)).'</div></div>';
	$overallSummaryHtml .=     '<div class="osBack"><button type="button" class="btn" id="osWordBtn">Download Word</button><button type="button" class="btn" id="osBackBtn">Back</button></div>';
	$overallSummaryHtml .=   '</div></div></div>';

	$overallSummaryHtml .=   '<div class="osWrap">';
	$overallSummaryHtml .=     '<div class="osGrid4">';
	/* (changed 2026-10) cards describe the current selection (same denominator as every %) */
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Coverage</div><div class="k">'.h((string)$selBlocksCount).'</div><div class="s">blocks</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Facilities</div><div class="k">'.h((string)$osDen).' <span class="sm">facilities</span></div><div class="m">Public: '.h((string)$selPub).' • Private: '.h((string)$selPri).'</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Area type</div><div class="k">'.h((string)$osDen).' <span class="sm">facilities</span></div><div class="m">Rural: '.h((string)$selRur).' • Urban: '.h((string)$selUrb).'</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Period</div><div class="k">'.h((string)count($selMonthKeysOrdered)).'</div><div class="s">months analysed</div></div>';
	$overallSummaryHtml .=     '</div>';

	$overallSummaryHtml .=     '<div class="osHero">';
	$overallSummaryHtml .=       '<div class="osScore">';
	$overallSummaryHtml .=         '<div class="osScoreRing"><canvas id="osScoreRing"></canvas><div class="osScoreText"><div class="n" id="osScoreNum">'.h($overallScore===null ? '—' : number_format((float)$overallScore, 1)).'</div><div class="l">Overall score (0–100)</div></div></div>';
	$overallSummaryHtml .=         '<div class="osScoreNote">Denominator: '.h((string)$osDen).' facilities under current selection.<br>Method: weighted score (DQA scoring method v8, same as the web application). Every standard check has a fixed weight ('.h($scorePeriodCount >= 2 ? 'multi-month weights: 2 or more months selected' : '1-month weights: 1 month selected').'); check score = 100 − % of facilities flagged; the weight of a check that cannot be run passes to the other checks. The score always uses the standard checks, whatever is ticked in the filters.</div>';
	$overallSummaryHtml .=       '</div>';
	$overallSummaryHtml .=       '<div class="osMiniGrid" id="osComponentMini">';
	foreach($osMini as $mi){
		$dqa_ms = ($mi['score']===null)
			? (($scorePeriodCount < 2 && $mi['id']==='accuracy') ? 'Not scored for 1 month' : 'No check could be run')
			: 'Top issue: '.number_format((float)$mi['maxTot'],1).'%';
		$overallSummaryHtml .= '<div class="osMini"><div class="h">'.h($mi['name']).'</div><div class="row"><div class="pct">'.h($mi['score']===null ? 'N/A' : number_format((float)$mi['score'],1)).'</div><div class="sub">score</div></div><div class="sub">'.h($dqa_ms).'</div></div>';
	}
	$overallSummaryHtml .=       '</div>';
	$overallSummaryHtml .=     '</div>';
	/* (added 2026-10) the score working, check by check (as in the web application's score breakdown) */
	$overallSummaryHtml .=     '<div class="osSection" data-comp="working">';
	$overallSummaryHtml .=       '<div class="osSectionHead"><div class="h">Score working</div><div class="sub">Weight used × check score ÷ 100 = points; the points add up to the overall score</div></div>';
	$overallSummaryHtml .=       '<div class="osTableWrap"><table class="osTbl"><thead><tr><th>Component</th><th>Check</th><th>Weight</th><th>Weight used</th><th>Facilities flagged</th><th>Check score</th><th>Points</th></tr></thead><tbody>';
	foreach($wScore['checks'] as $dqa_wc){
		$dqa_cn = isset($osComponents[$dqa_wc['comp']]) ? $osComponents[$dqa_wc['comp']]['name'] : $dqa_wc['comp'];
		$overallSummaryHtml .= '<tr><td>'.h($dqa_cn).'</td><td>'.h($dqa_wc['name']).'</td><td>'.h(number_format($dqa_wc['w'],2)).'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['used'],2) : '0 (cannot run)').'</td><td>'.h($dqa_wc['run'] ? $dqa_wc['flagged'].' of '.$osDen : '—').'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['score'],1) : '—').'</td><td>'.h($dqa_wc['run'] ? number_format($dqa_wc['points'],2) : '—').'</td></tr>';
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
		$overallSummaryHtml .=       '<div class="osImpactLegend"><div class="osLegRow"><span class="dot any"></span>Any month <span class="v" id="osImpactAny_'.h($gid).'">'.h(number_format($anyW,1)).'%</span></div><div class="osLegRow"><span class="dot all"></span>All&nbsp;months<br><span class="v" id="osImpactAll_'.h($gid).'">'.h(number_format($allW,1)).'%</span></div></div>';
		$overallSummaryHtml .=     '</div>';

		$overallSummaryHtml .=     '<div class="osPanel">';
		$overallSummaryHtml .=       '<div class="osPanelTitle">Top KPIs</div>';
		$overallSummaryHtml .=       '<div class="osTableWrap"><table class="osTbl" id="osTbl_'.h($gid).'"><thead><tr><th>KPI</th><th>Facilities</th><th>%</th></tr></thead><tbody>';
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

	$overallSummaryHtml .=     '<div class="osFoot">Tip: Percentages use denominator of total facilities under current selection.</div>';
	$overallSummaryHtml .=   '</div>';
	$overallSummaryHtml .= '</div>';

	/* (added 2026-10) data of the DQA 2-pager report (small unlabelled button, top left); see dqa2p_build() */
	$dqa2pSel = array();
	$dqa2pSelSet = array_fill_keys(array_map('strval', (array)$filters['blocks']), true);
	$dqa2pBlk = array();
	foreach($allBlocks as $dqa2p_b => $dqa2p_x){ if(isset($dqa2pSelSet[(string)$dqa2p_b])) $dqa2pBlk[] = display_block_label((string)$dqa2p_b); }
	if(count($dqa2pBlk) < count($allBlocks)){
		natcasesort($dqa2pBlk);
		$dqa2pSel[] = (count($dqa2pBlk) <= 8)
			? 'Blocks ('.count($dqa2pBlk).' of '.count($allBlocks).'): '.implode(', ', $dqa2pBlk)
			: 'Blocks: '.count($dqa2pBlk).' of '.count($allBlocks).' selected';
	}
	if($dqaOwnOn && !$dqaOwnAll) $dqa2pSel[] = 'Ownership: '.implode(', ', array_map('strval', (array)$filters['ownership']));
	if($dqaRuOn && !$dqaRuAll) $dqa2pSel[] = 'Rural/Urban: '.implode(', ', array_map('strval', (array)$filters['ru']));
	$dqa2pJson = dqa2p_json(dqa2p_build(array(
		'kind'=>'hp', 'tool'=>'HMIS', 'cards'=>$scoreCardsList, 'comps'=>$osComponents, 'overall'=>$overallScore, 'den'=>$osDen,
		'units'=>$facFiltered, 'sets'=>$scoreSets, /* (changed 2026-10) the checks the score is computed from */
		'state'=>$stateName, 'district'=>$distName, 'months'=>$selMonthKeysOrdered, 'blocksCount'=>$selBlocksCount,
		'selection'=>$dqa2pSel, 'filters'=>$filters
	)));

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
			--group-comp:#6366f1;
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

		.infoRow{display:grid;grid-template-columns:repeat(5,minmax(160px,1fr));gap:12px;margin-bottom:12px;}
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
			background:linear-gradient(145deg,rgba(224,242,254,0.98),rgba(191,219,254,0.98));
			color:#0369a1;box-shadow:0 7px 0 rgba(37,99,235,.45),0 12px 22px rgba(59,130,246,.30);
		}
		.groupBtn.completeness{
			background:linear-gradient(145deg,rgba(224,231,255,0.98),rgba(199,210,254,0.98));
			color:#3730a3;box-shadow:0 7px 0 rgba(79,70,229,.45),0 12px 22px rgba(99,102,241,.30);
		}
		.groupBtn.accuracy{
			background:linear-gradient(145deg,rgba(255,237,213,0.98),rgba(254,215,170,0.98));
			color:#9a3412;box-shadow:0 7px 0 rgba(234,88,12,.50),0 12px 22px rgba(249,115,22,.30);
		}
		.groupBtn.consistency{
			background:linear-gradient(145deg,rgba(220,252,231,0.98),rgba(187,247,208,0.98));
			color:#166534;box-shadow:0 7px 0 rgba(22,163,74,.50),0 12px 22px rgba(34,197,94,.30);
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
		.kpi.group-completeness h3{background:var(--group-comp);}
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
		.dqaNote{margin:0 0 12px;padding:10px 14px;border-radius:14px;border:1px solid #fcd34d;background:#fffbeb;color:#92400e;font-weight:700;font-size:13px;} /* (added) */

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

#osOverlay .osGrid4{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; margin-top:14px; }
@media (max-width: 980px){ #osOverlay .osGrid4{ grid-template-columns:repeat(2, minmax(0,1fr)); } }
@media (max-width: 560px){ #osOverlay .osGrid4{ grid-template-columns:1fr; } }

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
</head>
<body data-hasapplied="<?=h($hasAppliedFlag)?>" data-showoutliers="<?=h($showOutliersFlag)?>" data-showdropouts="<?=h($showDropoutsFlag)?>" data-justuploaded="<?=h($justUploadedFlag)?>">
<div class="container" id="pageRoot">
	<div class="topbar">
		<div>
			<h1><?=h($APP_NAME)?></h1>
			<div class="top-meta">Source file: <b><?=h($fileName)?></b></div>
		</div>
		<div>
			<button class="btn btnDisabled" id="btnPdf" disabled>Download to PDF</button>
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
		</div>
		<div class="infoBox">
			<div class="statTitle">Number of Blocks</div>
			<div class="statValue"><?= (int)$globalBlocksCount ?></div>
		</div>
		<div class="infoBox">
			<div class="statTitle">Number of facilities</div>
			<div class="statValue"><?= (int)$globalDen ?></div>
			<div class="statSmall">Public: <?= (int)$globalPub ?> | Private: <?= (int)$globalPri ?> &nbsp; | &nbsp; Rural: <?= (int)$globalRur ?> | Urban: <?= (int)$globalUrb ?></div>
		</div>
	</div>
	<?php if($dqaBadMonthRows > 0): ?>
	<div class="dqaNote">Note: <?= (int)$dqaBadMonthRows ?> row<?= ($dqaBadMonthRows===1 ? ' was' : 's were') ?> left out because the Month could not be read (e.g. &ldquo;<?=h($dqaBadMonthExample)?>&rdquo;).</div>
	<?php endif; ?>
	<?php if($dqaDupRows > 0): ?>
	<div class="dqaNote">Note: <?= (int)$dqaDupRows ?> row<?= ($dqaDupRows===1 ? ' of the file repeats' : 's of the file repeat') ?> a facility and month already present (same Block Name and Facility Name), e.g. <?=h($dqaDupExample)?>. For each such facility and month only the first row is analysed and highlighted.</div>
	<?php endif; ?>

	<div class="componentsBox">
		<div class="componentsLabelBox"><div class="componentsLabelText">Components of Data Quality</div></div>
		<div class="groupRow">
			<div class="groupCol">
				<button type="button" class="groupBtn availability" data-group="availability" title="All reports for the study period must be available in the portal at the time of assessment">Availability</button>
				<ul class="kpiBullets">
					<li>All Indicators Blank</li>
					<li>All Indicators having 0 values but not blank</li>
					<li>Duplicate Monthly Record</li>
					<li>Session Not Held but Vaccinated</li>
				</ul>
			</div>

			<div class="groupCol">
				<button type="button" class="groupBtn completeness" data-group="completeness" title="All immunization related data fields (M9 section) must be filled in HMIS portal">Completeness</button>
				<ul class="kpiBullets">
					<li>Key Missing Indicators</li>
				</ul>
			</div>

			<div class="groupCol">
				<button type="button" class="groupBtn accuracy" data-group="accuracy" title="Identification of logical errors and outliers in immunization data of HMIS portal">Accuracy</button>
				<ul class="kpiBullets">
					<li>Outliers</li>
					<li>Dropouts (selected pairs)</li>
				</ul>
			</div>

			<div class="groupCol">
				<button type="button" class="groupBtn consistency" data-group="consistency" title="Identification of discrepencies as per immunization logics">Consistency</button>
				<ul class="kpiBullets">
					<li class="kpiHeaderNoBullet"><b>Inconsistencies between sessions and doses</b></li>
					<?php if($sessAvailable): ?><li>Sessions Held &gt; Sessions Planned</li><?php endif; ?>
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
					<!-- Block -->
					<div class="filterGroup">
						<div class="filterShell">
							<details>
								<summary>Block Name</summary>
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

					<!-- Vaccines (Completeness/Accuracy only) -->
					<div class="filterGroup vaxOnly" style="display:none">
						<div class="filterShell">
							<details>
								<summary>Key Indicators (Outliers)</summary>
								<div class="filterDropdown">
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_vax[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($KEY_VAX as $vx): ?>
											<?php $chk = (empty($filters['outliers_vax']) || in_array($vx,$filters['outliers_vax'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="outliers_vax[]" value="<?=h($vx)?>" <?=$chk?>> <?=h($vx)?></label>
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
									<div class="small"><b>Increase buckets</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_inc[]"> Select All</label>
									<div class="chkWrap">
										<?php $incOpts=[['INC_LOW','25 to <50% Low'],['INC_MOD','50–100% Moderate'],['INC_EXT','>100% or from 0 Extreme']]; foreach($incOpts as $opt): $chk = (in_array($opt[0], (array)$filters['outliers_inc'], true)) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="outliers_inc[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

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
										<?php $drOpts=[ ['R5_10','5 to <10% (Low)'], ['R11_20','10 to <20% (Moderate)'], ['R20P','20% or more (High)'] ]; foreach($drOpts as $opt): $chk = (empty($filters['drop_ranges']) || in_array($opt[0],$filters['drop_ranges'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="drop_ranges[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

									<div class="small" style="margin-top:8px"><b>Pairs</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="drop_pairs[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($PAIR_OPTIONS as $pr): ?>
											<?php $chk = (empty($filters['drop_pairs']) || in_array($pr,$filters['drop_pairs'],true))?'checked':''; ?>
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
														<option value="<?=h($vx)?>" <?=$s?>><?=h($vx)?></option>
													<?php endforeach; ?>
												</select>

												<select name="drop_to[]" class="pairSelect">
													<option value="" <?=($selTo===''?'selected':'')?>>Vaccine-2</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selTo) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h($vx)?></option>
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
														<option value="<?=h($vx)?>" <?=$s?>><?=h($vx)?></option>
													<?php endforeach; ?>
												</select>

												<select name="incons_to[]" class="pairSelect">
													<option value="" <?=($selTo===''?'selected':'')?>>Vaccine-2</option>
													<?php foreach($ADD_VAX as $vx): ?>
														<?php $s = ($vx===$selTo) ? 'selected' : ''; ?>
														<option value="<?=h($vx)?>" <?=$s?>><?=h($vx)?></option>
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
					<div class="filterGroup">
						<div class="filterShell">
							<details>
								<summary>Additional Filter</summary>
								<div class="filterDropdown">
									<?php /* (changed 2026-10) a filter whose column is not in the file is hidden (and not applied) */ ?>
									<div<?=($dqaOwnOn ? '' : " style='display:none'")?>>
									<div class="small"><b>Ownership</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="ownership[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach(['Public','Private'] as $o): ?>
											<?php $chk = (empty($filters['ownership']) || in_array($o,$filters['ownership'],true) || !$dqaOwnOn) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="ownership[]" value="<?=h($o)?>" <?=$chk?>> <?=h($o)?></label>
										<?php endforeach; ?>
									</div>
									</div>

									<div<?=($dqaRuOn ? '' : " style='display:none'")?>>
									<div class="small" style="margin-top:8px"><b>Rural/Urban</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="ru[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach(['Rural','Urban'] as $ru): ?>
											<?php $chk = (empty($filters['ru']) || in_array($ru,$filters['ru'],true) || !$dqaRuOn) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="ru[]" value="<?=h($ru)?>" <?=$chk?>> <?=h($ru)?></label>
										<?php endforeach; ?>
									</div>
									</div>

									<!-- Additional Indicators -->
									<div class="addVaxWrap" style="margin-top:8px;">
										<div class="small"><b>Additional Indicators</b></div>
										<label class="chk"><input type="checkbox" data-role="selectall" data-target="add_vax[]"> Select All</label>
										<div class="chkWrap">
											<?php foreach($ADD_VAX as $vx): ?>
												<?php $chk = (!empty($filters['add_vax']) && in_array($vx,$filters['add_vax'],true)) ? 'checked' : ''; ?>
												<label class="chk"><input type="checkbox" name="add_vax[]" value="<?=h($vx)?>" <?=$chk?>> <?=h($vx)?></label>
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
				<div class="consGroupTitle">Inconsistencies between sessions and doses</div>
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
				<div class="consGroupTitle">Inconsistencies between sessions and doses</div>
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
	<form id="osWordForm" method="post" style="display:none;">
		<input type="hidden" name="action" value="download_word_overall">
		<input type="hidden" name="access_code" value="<?=h($GLOBALS['ACCESS_CODE_CURRENT'])?>">
		<textarea name="os_word_html" id="osWordHtml" style="display:none;"></textarea>
	</form>

<script>
const BASE_URL = "<?=h($BASE_URL)?>";
const CHARTS = <?= $chartsJson ? $chartsJson : "{}" ?>;
window.__OS_DATA__ = <?= $osDataJson ? $osDataJson : 'null' ?>;
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

	const isAcc = group === 'accuracy';
	const isComp = group === 'completeness';
	const isCons = group === 'consistency';

	vaxOnly.forEach(el=>{ el.style.display = (isAcc || isComp) ? '' : 'none'; });
	accOnly.forEach(el=>{ el.style.display = isAcc ? '' : 'none'; });
	outOnly.forEach(el=>{ el.style.display = (isAcc && showOutliers) ? '' : 'none'; });
	dropOnly.forEach(el=>{ el.style.display = (isAcc && showDropouts) ? '' : 'none'; });

	/* NEW: show inconsistencies pair builder only for Consistency */
	consOnly.forEach(el=>{ el.style.display = isCons ? '' : 'none'; });
	addWrap.forEach(el=>{ el.style.display = (isAcc || isComp) ? '' : 'none'; });
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
				backgroundColor: payload.color || '#0ea5e9',
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
	const btn = document.getElementById('btnPdf');
	if(!btn) return;
	btn.addEventListener('click', ()=>window.print());
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

	// Initial: if previously selected group exists, restore selection UI
	const initGroup = (document.getElementById('activeGroupInput') && document.getElementById('activeGroupInput').value) ? document.getElementById('activeGroupInput').value : '';
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
	var word = document.getElementById('osWordBtn');
	var wordForm = document.getElementById('osWordForm');
	var wordHtml = document.getElementById('osWordHtml');
	var hasApplied = document.body.getAttribute('data-hasapplied') === '1';

	function renderOsCharts(){
		if(typeof Chart==='undefined') return;
		if(!window.__OS_DATA__) return;
		var data = window.__OS_DATA__;
			var compColors = {
				availability: '#1d4ed8',
				completeness: '#5b21b6',
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

	function buildWordExportHtml(){
		// Word is very limited with modern CSS (grid/flex) and canvas rendering.
		// So we generate a Word-friendly HTML (tables + inline styles) and embed
		// charts as PNG images from the already-rendered canvases.
		try{
			renderOsCharts();
		}catch(e){}
		if(!window.__OS_DATA__) return '';
		var data = window.__OS_DATA__;
		var titleEl = document.querySelector('#osOverlay .osTitle');
		var metaEl  = document.querySelector('#osOverlay .osMeta');
		var title = titleEl ? (titleEl.textContent||'').trim() : 'Overall Score';
		var meta  = metaEl ? (metaEl.textContent||'').trim() : '';
		// Ensure a readable gap between labels and values for Word export (e.g., 'State: UP' not 'State:UP').
		meta = meta.replace(/(\b(?:State|District|Duration|Months|Blocks|Ownership|Rural\/Urban)\b)\s*:\s*/g, '$1: ');

		function esc(s){
			s = (s===null||typeof s==='undefined') ? '' : String(s);
			return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
		}
		function n1(x){
			var v = (typeof x==='number') ? x : parseFloat(x);
			if(isNaN(v)) v = 0;
			return (Math.round(v*10)/10).toFixed(1);
		}
		function getCanvasPng(id){
			try{
				var c = document.getElementById(id);
				if(c && c.toDataURL) return c.toDataURL('image/png');
			}catch(e){}
			return '';
		}

		var css = '';
		css += "<style>";
		css += "body{font-family:Calibri,Arial,sans-serif;font-size:12pt;color:#111;}";
		css += ".osWTitle{font-size:20pt;font-weight:900;margin:0 0 4pt 0;}";
		css += ".osWMeta{font-size:12pt;font-weight:700;color:#334155;margin:0 0 12pt 0;}";
		css += ".box{border:1px solid #cbd5e1;border-radius:12px;padding:10pt;}";
		css += ".muted{color:#475569;font-weight:700;}";
		css += ".k{font-size:20pt;font-weight:900;}";
		css += ".sm{font-size:11pt;font-weight:700;color:#475569;}";
		css += ".tbl{border-collapse:collapse;width:100%;}";
		css += ".tbl th,.tbl td{border:1px solid #cbd5e1;padding:6pt 7pt;vertical-align:top;}";
		css += ".tbl th{background:#f8fafc;font-weight:900;}";
		css += ".secHead{font-size:16pt;font-weight:900;margin:14pt 0 6pt 0;}";
		css += ".secSub{font-size:11pt;font-weight:800;color:#64748b;margin-left:6pt;}";
		css += ".impactRow{margin-top:8pt;}";
		css += ".dot{display:inline-block;width:10pt;height:10pt;border-radius:50%;margin-right:6pt;vertical-align:middle;}";
		css += ".dotAny{background:#2563eb;} .dotAll{background:#0f766e;}";
		css += ".impactVal{font-weight:900;font-size:12pt;margin-left:6pt;}";
		css += ".imgBox{border:1px solid #cbd5e1;border-radius:12px;padding:8pt;}";
		css += ".osBarImg{max-width:660pt;width:660pt;height:auto;}";
		css += "</style>";

		var html = '';
		html += css;
		html += '<div class="osWTitle">'+esc(title)+'</div>';
		if(meta) html += '<div class="osWMeta">'+esc(meta)+'</div>';

		// Top stats cards (read from rendered page text to keep values exactly the same)
		var cards = document.querySelectorAll('#osOverlay .osGrid4 .osCard');
		html += '<table class="tbl" style="margin-bottom:12pt;"><tr>';
		for(var ci=0; ci<cards.length; ci++){
			var c = cards[ci];
			var t = c.querySelector('.t');
			var k = c.querySelector('.k');
			var s = c.querySelector('.s');
			var m = c.querySelector('.m');
			html += '<td style="width:25%;padding:0;border:0;">';
			html += '<div class="box" style="margin:0 6pt 0 0;">';
			html += '<div class="muted">'+esc(t ? t.textContent : '')+'</div>';
			html += '<div class="k">'+esc(k ? k.textContent : '')+'</div>';
			if(m && (m.textContent||'').trim()!=='') html += '<div class="sm">'+esc(m.textContent)+'</div>';
			if(s && (s.textContent||'').trim()!=='') html += '<div class="sm">'+esc(s.textContent)+'</div>';
			html += '</div></td>';
		}
		html += '</tr></table>';

		// Hero: score + mini grid
		var scorePng = getCanvasPng('osScoreRing');
		html += '<table class="tbl" style="border:0;margin-bottom:12pt;">';
		html += '<tr>';
		html += '<td style="width:42%;border:0;vertical-align:top;">';
		html += '<div class="box">';
		if(scorePng){
			html += '<table style="width:100%;border-collapse:collapse;"><tr>';
			html += '<td style="width:42%;border:0;vertical-align:middle;">';
			html += '<img src="'+scorePng+'" style="width:180pt;height:auto;display:block;" />';
			html += '</td><td style="border:0;vertical-align:middle;">';
			var scoreNumEl = document.getElementById('osScoreNum');
			html += '<div style="font-size:34pt;font-weight:900;line-height:1;">'+esc(scoreNumEl?scoreNumEl.textContent:'')+'</div>';
			html += '<div class="sm">Overall score (0–100)</div>';
			html += '</td></tr></table>';
		}
		var noteEl = document.querySelector('#osOverlay .osScoreNote');
		if(noteEl) html += '<div class="sm" style="margin-top:8pt;">'+esc(noteEl.textContent)+'</div>';
		html += '</div>';
		html += '</td>';

		html += '<td style="width:58%;border:0;vertical-align:top;">';
		var minis = document.querySelectorAll('#osOverlay .osMiniGrid .osMini');
		html += '<table class="tbl" style="border:0;">';
		for(var mi=0; mi<minis.length; mi++){
			if(mi % 2 === 0) html += '<tr>';
			var mbox = minis[mi];
			var hEl = mbox.querySelector('.h');
			var pctEl = mbox.querySelector('.pct');
			var subEls = mbox.querySelectorAll('.sub');
			html += '<td style="width:50%;border:0;vertical-align:top;padding:0 0 6pt 6pt;">';
			html += '<div class="box">';
			html += '<div style="font-weight:900;font-size:13pt;margin-bottom:4pt;">'+esc(hEl?hEl.textContent:'')+'</div>';
			html += '<div style="font-size:22pt;font-weight:900;">'+esc(pctEl?pctEl.textContent:'')+'</div>';
			html += '<div class="sm">score</div>';
			if(subEls && subEls.length>0){
				for(var si=0; si<subEls.length; si++){
					if((subEls[si].textContent||'').trim()!=='score') html += '<div class="sm">'+esc(subEls[si].textContent)+'</div>';
				}
			}
			html += '</div></td>';
			if(mi % 2 === 1) html += '</tr>';
		}
		if(minis.length % 2 === 1) html += '<td style="width:50%;border:0;"></td></tr>';
		html += '</table>';
		html += '</td>';
		html += '</tr></table>';

		// Component sections
		var compOrder = ['availability','completeness','accuracy','consistency'];
		for(var oi=0; oi<compOrder.length; oi++){
			var gid = compOrder[oi];
			var comp = data.components && data.components[gid] ? data.components[gid] : null;
			if(!comp) continue;
			html += '<div class="secHead">'+esc(comp.name||gid)+' <span class="secSub">Indicators violating expected data behaviour</span></div>';
			html += '<table class="tbl" style="border:0;margin-bottom:10pt;">';
			html += '<tr>';
			html += '<td style="width:28%;border:0;vertical-align:top;padding:0 6pt 0 0;">';
			html += '<div class="box">';
			html += '<div style="font-weight:900;font-size:13pt;margin-bottom:8pt;">Impact</div>';
			html += '<div class="impactRow"><span class="dot dotAny"></span><span style="font-weight:900;">Any month</span><span class="impactVal">'+n1(comp.maxAny||0)+'%</span></div>';
			html += '<div class="impactRow"><span class="dot dotAll"></span><span style="font-weight:900;">All months</span><span class="impactVal">'+n1(comp.maxAll||0)+'%</span></div>';
			html += '</div>';
			html += '</td>';
			html += '<td style="width:72%;border:0;vertical-align:top;padding:0;">';
			html += '<div class="box">';
			html += '<div style="font-weight:900;font-size:13pt;margin-bottom:8pt;">Top KPIs</div>';
			html += '<table class="tbl">';
			html += '<thead><tr><th style="width:64%;">KPI</th><th style="width:18%;">Facilities</th><th style="width:18%;">%</th></tr></thead><tbody>';
			var top = comp.top || [];
			for(var ti=0; ti<top.length; ti++){
				var r = top[ti];
				html += '<tr><td>'+esc(r.name)+'</td><td>'+esc(r.total)+'</td><td>'+n1(r.pct||0)+'%</td></tr>';
			}
			if(top.length===0) html += '<tr><td colspan="3">—</td></tr>';
			html += '</tbody></table>';
			html += '</div>';
			html += '</td>';
			html += '</tr></table>';

			// Highlights chart image
			var barPng = getCanvasPng('osBar_'+gid);
			if(barPng){
				html += '<div class="imgBox" style="margin-bottom:10pt;">';
				html += '<div style="font-weight:900;font-size:13pt;margin-bottom:8pt;">Highlights</div>';
				html += '<img src="'+barPng+'" class="osBarImg" style="width:660pt;height:auto;display:block;" width="880" />';
				html += '</div>';
			}
		}

		return html;
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
	if(word && wordForm && wordHtml){
		word.addEventListener('click', function(){
			try{
				renderOsCharts();
				var html = buildWordExportHtml();
				wordHtml.value = html;
				wordForm.submit();
			}catch(e){
				alert('Unable to generate Word file. Please try again.');
			}
		});
	}
})();


init();
</script>
<script>
window.__DQA2P__ = <?= isset($dqa2pJson) ? $dqa2pJson : 'null' ?>;
/* (added 2026-10) DQA 2-pager report (A4 portrait, always 2 pages) of the results shown on this
   page, opened by a very small unlabelled button at the top left of the page. It opens in a new tab
   with the print window over it, where
   "Save as PDF" saves it (or it can be printed). Every figure comes from window.__DQA2P__, built
   on the server from the same data as the cards, panels and Overall Score of this page, so the
   report always matches the page it was opened from. The layout is measured and made more
   compact (smaller type, lower charts, tighter rows) only as much as needed to keep the whole
   report on two pages, whatever the number of blocks or KPIs. */
(function(){
	'use strict';
	var D = window.__DQA2P__;
	if(!D || !document.body || document.body.getAttribute('data-hasapplied') !== '1') return;

	var FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
	var FONT_H = 'Cambria, Caladea, Georgia, "Times New Roman", serif';
	var C = { brand:'#0B4F6C', brandDk:'#083A50', teal:'#0B7A75', amber:'#F59E0B', amberLt:'#FCD34D',
		ink:'#1E293B', muted:'#64748B', line:'#D3E1E8', panel:'#EEF5F8', panel2:'#F7FAFC', track:'#E3ECF1', grid:'#E8EEF2',
		red:'#DC2626', redBg:'#FDE8E8', redTx:'#B91C1C', amb:'#F59E0B', ambBg:'#FEF3C7', ambTx:'#92400E',
		grn:'#16A34A', grnBg:'#DCFCE7', grnTx:'#166534', tot:'#E1EEF4' };
	/* component colours = the tool's own Overall Score page */
	var COMP = { availability:'#1d4ed8', completeness:'#5b21b6', accuracy:'#9a3412', consistency:'#047857' };
	var PT_W = 595.28;                   /* A4 width (pt) */
	var PG_H = 296.8 / 25.4 * 72;        /* page box height (pt): a hair under A4, so no blank sheet is added */
	var ML = 34, MT = 26, MB = 30;       /* side / top / bottom margins (pt); the page line sits in the bottom margin */
	var CW = PT_W - 2 * ML;              /* content width (pt) */
	var CH = PG_H - MT - MB;             /* content height per page (pt) */
	var PX = 96 / 72;                    /* CSS px per pt */
	var NS = 'http://www.w3.org/2000/svg';
	var unit = String(D.unit || 'facilities'), unitOne = String(D.unitOne || 'facility');

	function L(a, b, c){ return a + (b - a) * c; }
	function cap(s){ s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
	function titleCase(s){ return String(s).replace(/(^|\s)(\S)/g, function(m, a, b){ return a + b.toUpperCase(); }); }
	function esc(s){ return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
	function r2(v){ return Math.round(v * 100) / 100; }
	function pt(v){ return r2(v) + 'pt'; }
	function joinNames(a){ a = (a || []).slice(); if(a.length <= 1) return a.join(''); return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
	function compColor(id){ return COMP[id] || C.brand; }
	function E(doc, tag, cls, txt){ var e = doc.createElement(tag); if(cls) e.className = cls; if(txt !== undefined && txt !== null) e.textContent = String(txt); return e; }
	function S(doc, tag, at){ var e = doc.createElementNS(NS, tag); if(at){ for(var k in at){ if(Object.prototype.hasOwnProperty.call(at, k)) e.setAttribute(k, String(at[k])); } } return e; }
	function T(doc, x, y, txt, size, o){
		o = o || {};
		var e = S(doc, 'text', { x: r2(x), y: r2(y), 'font-size': r2(size), 'font-family': o.font || FONT, fill: o.fill || C.ink, 'text-anchor': o.anchor || 'start' });
		if(o.bold) e.setAttribute('font-weight', 'bold');
		if(o.rot) e.setAttribute('transform', 'rotate(' + o.rot + ' ' + r2(x) + ' ' + r2(y) + ')');
		e.textContent = String(txt);
		return e;
	}
	function svgBox(doc, w, h){ return S(doc, 'svg', { width: r2(w) + 'pt', height: r2(h) + 'pt', viewBox: '0 0 ' + r2(w) + ' ' + r2(h) }); }
	function svgH(svg){ return parseFloat(svg.getAttribute('height')); }
	/* text width in pt, measured with the report's own font */
	function measurer(doc){
		var ctx = null, cache = {};
		try{ ctx = doc.createElement('canvas').getContext('2d'); }catch(e){ ctx = null; }
		return function(txt, size, bold){
			txt = String(txt);
			var key = (bold ? 'b' : 'n') + size + '|' + txt;
			if(cache.hasOwnProperty(key)) return cache[key];
			var w;
			if(ctx){ ctx.font = (bold ? 'bold ' : '') + size + 'pt ' + FONT; w = ctx.measureText(txt).width * 0.75; }
			else w = txt.length * size * 0.55;
			cache[key] = w;
			return w;
		};
	}
	function wrap(M, txt, maxW, size, bold, maxLines){
		var words = String(txt === null || txt === undefined ? '' : txt).split(/\s+/).filter(function(w){ return w !== ''; });
		var lines = [], cur = '', i, j;
		for(i = 0; i < words.length; i++){
			var w = words[i];
			if(M(w, size, bold) > maxW){
				if(cur !== ''){ lines.push(cur); cur = ''; }
				var part = '';
				for(j = 0; j < w.length; j++){
					var t = part + w.charAt(j);
					if(part !== '' && M(t, size, bold) > maxW){ lines.push(part); part = w.charAt(j); } else part = t;
				}
				cur = part;
				continue;
			}
			var t2 = (cur === '') ? w : cur + ' ' + w;
			if(M(t2, size, bold) <= maxW) cur = t2; else { lines.push(cur); cur = w; }
		}
		if(cur !== '') lines.push(cur);
		if(!lines.length) lines.push('');
		if(maxLines && lines.length > maxLines){
			var keep = lines.slice(0, maxLines), last = keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' ');
			while(last.length > 1 && M(last + '…', size, bold) > maxW) last = last.slice(0, -1);
			keep[maxLines - 1] = last.replace(/\s+$/, '') + '…';
			lines = keep;
		}
		return lines;
	}
	/* axis maximum and step (whole numbers), with room above the tallest bar */
	function niceAxis(maxV){
		if(!(maxV > 0)) return { max: 1, step: 1 };
		var raw = maxV / 4, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
		var s = (f <= 1) ? 1 : (f <= 2) ? 2 : (f <= 5) ? 5 : 10;
		var step = Math.max(1, Math.round(s * p));
		var mx = Math.ceil(maxV / step) * step;
		if(mx <= maxV) mx += step;
		return { max: mx, step: step };
	}

	/* ---------- look: every size follows the compactness level c (0 = roomy ... 1 = compact) ---------- */
	function sty(c){
		return { c: c,
			fs: L(9.4, 7.4, c), fsS: L(7.3, 6.1, c), title: L(16, 12.6, c), h2: L(10.8, 8.8, c), ct: L(8.4, 7, c), kf: L(9.1, 7.2, c),
			gap: L(9, 3.6, c), pad: L(8, 4.2, c), band: L(11, 6, c), chipPad: L(3.6, 1.8, c),
			ring: L(78, 52, c), ringW: L(8.5, 6, c), tile: L(19, 13.5, c),
			issH: L(66, 30, c), impH: L(54, 24, c), minH: L(96, 58, c),
			kRow: L(15.5, 9.6, c), kLbl: L(6.7, 5.7, c), kVal: L(7, 5.9, c), kLW: L(112, 96, c),
			xLbl: L(6.7, 5.7, c), xVal: L(7.2, 5.9, c), yLbl: L(7, 5.9, c),
			tFs: L(8.9, 6.7, c), tPad: L(3.1, 0.8, c), t3Pad: L(3.3, 0.8, c)
		};
	}

	/* ---------- charts ---------- */
	/* vertical bars (one bar per block) */
	function vchart(doc, M, o){
		var n = o.labels.length, W = o.w, i, j, t;
		var maxV = 0;
		for(i = 0; i < n; i++){ if((+o.vals[i] || 0) > maxV) maxV = +o.vals[i] || 0; }
		var ax = niceAxis(maxV), yW = 0;
		if(o.yAxis){ for(t = 0; t <= ax.max; t += ax.step) yW = Math.max(yW, M(String(t), o.yLbl)); yW += 7; }
		var x0 = o.yAxis ? yW : 3, plotW = W - x0 - 3, slot = plotW / Math.max(n, 1);
		var lblW = Math.max(4, slot - 3), rot = false, lines = [];
		for(i = 0; i < n; i++){
			var Lb = String(o.labels[i]), words = Lb.split(/\s+/);
			for(j = 0; j < words.length; j++){ if(M(words[j], o.lblSize) > lblW){ rot = true; break; } }
			var ln = wrap(M, Lb, lblW, o.lblSize, false, 0);
			if(ln.length > o.maxLines) rot = true;
			lines.push(ln);
		}
		var ls = o.lblSize, rl = [], lblH, mw = 0, ROTMAX = 72;
		if(rot){
			for(i = 0; i < n; i++){
				var s = String(o.labels[i]);
				if(M(s, ls) > ROTMAX){ while(s.length > 1 && M(s + '…', ls) > ROTMAX) s = s.slice(0, -1); s = s + '…'; }
				rl.push(s); mw = Math.max(mw, M(s, ls));
			}
			lblH = mw * 0.7071 + ls * 1.7;
			var need = mw * 0.7071 - slot / 2 + 3;          /* the first label leans left: keep it inside the chart */
			if(need > x0){ x0 = need; plotW = W - x0 - 3; slot = plotW / Math.max(n, 1); }
		} else {
			var ml = 1;
			for(i = 0; i < n; i++) ml = Math.max(ml, lines[i].length);
			lblH = ml * ls * 1.2 + 3;
		}
		var vs = Math.max(5, Math.min(o.valSize, slot * 0.75));
		var barW = Math.min(o.barMax, slot * o.barRatio);
		var topH = vs * 1.5, plotH = o.plotH, H = topH + plotH + lblH;
		var svg = svgBox(doc, W, H), yB = topH + plotH;
		if(o.yAxis){
			for(t = 0; t <= ax.max; t += ax.step){
				var yy = yB - t / ax.max * plotH;
				if(t > 0) svg.appendChild(S(doc, 'line', { x1: r2(x0), y1: r2(yy), x2: r2(x0 + plotW), y2: r2(yy), stroke: C.grid, 'stroke-width': 0.6 }));
				svg.appendChild(T(doc, x0 - 5, yy + o.yLbl * 0.35, String(t), o.yLbl, { anchor: 'end', fill: C.muted }));
			}
		}
		for(i = 0; i < n; i++){
			var v = +o.vals[i] || 0, cx = x0 + slot * i + slot / 2, h = v / ax.max * plotH;
			if(h > 0) svg.appendChild(S(doc, 'rect', { x: r2(cx - barW / 2), y: r2(yB - h), width: r2(barW), height: r2(h), rx: r2(Math.min(2, barW / 4, h / 2)), fill: o.color }));
			svg.appendChild(T(doc, cx, yB - h - vs * 0.45, String(v), vs, { anchor: 'middle', fill: v > 0 ? o.valFill : C.muted, bold: v > 0 && o.valBold }));
		}
		svg.appendChild(S(doc, 'line', { x1: r2(x0), y1: r2(yB), x2: r2(x0 + plotW), y2: r2(yB), stroke: o.baseColor, 'stroke-width': 0.8 }));
		for(i = 0; i < n; i++){
			var lx = x0 + slot * i + slot / 2;
			if(rot){ svg.appendChild(T(doc, lx + ls * 0.3, yB + ls * 1.15, rl[i], ls, { anchor: 'end', rot: -45, fill: C.ink })); }
			else { for(j = 0; j < lines[i].length; j++) svg.appendChild(T(doc, lx, yB + ls * (1.2 * j + 1.2), lines[i][j], ls, { anchor: 'middle', fill: C.ink })); }
		}
		return svg;
	}
	/* horizontal bars (the KPIs of one component); the worst KPI in amber */
	function hchart(doc, M, o, st){
		var items = o.items, n = items.length, W = o.w, i, j;
		var LW = st.kLW, ls = st.kLbl, vs = st.kVal, x0 = LW + 4, texts = [], vW = 0, maxN = 0;
		for(i = 0; i < n; i++){
			texts.push(items[i].n + ' (' + items[i].pct + '%)');
			vW = Math.max(vW, M(texts[i], vs, true));
			if(items[i].n > maxN) maxN = items[i].n;
		}
		var maxBar = Math.max(20, W - x0 - vW - 8), lines = [], need = [], nat = 4;
		for(i = 0; i < n; i++){
			lines.push(wrap(M, items[i].name, LW - 2, ls, items[i].worst, 3));
			need.push(Math.max(st.kRow, lines[i].length * ls * 1.2 + 4));
			nat += need[i];
		}
		var H = Math.max(nat, o.H || 0), extra = H - nat, rows = need.slice();
		if(extra > 0 && n > 0){ var per = extra / n; for(i = 0; i < n; i++) rows[i] = Math.max(need[i], Math.min(need[i] + per, 30)); }
		var used = 4;
		for(i = 0; i < n; i++) used += rows[i];
		var top = 2 + Math.max(0, (H - used) / 2), svg = svgBox(doc, W, H), y = top;
		for(i = 0; i < n; i++){
			var rh = rows[i], cy = y + rh / 2, Ln = lines[i], lh = ls * 1.2, ty = cy - (Ln.length - 1) * lh / 2 + ls * 0.35, wst = items[i].worst;
			for(j = 0; j < Ln.length; j++) svg.appendChild(T(doc, x0 - 5, ty + j * lh, Ln[j], ls, { anchor: 'end', bold: wst, fill: wst ? C.ink : '#334155' }));
			var bw = maxN > 0 ? items[i].n / maxN * maxBar : 0, bh = Math.min(13, Math.max(5, rh * 0.62));
			svg.appendChild(S(doc, 'rect', { x: r2(x0), y: r2(cy - bh / 2), width: r2(maxBar), height: r2(bh), rx: r2(Math.min(2, bh / 3)), fill: C.panel2 }));
			if(bw > 0) svg.appendChild(S(doc, 'rect', { x: r2(x0), y: r2(cy - bh / 2), width: r2(Math.max(bw, 1.2)), height: r2(bh), rx: r2(Math.min(2, bh / 3, bw / 2)), fill: wst ? C.amber : o.color }));
			svg.appendChild(T(doc, x0 + Math.max(bw, 0) + 3.5, cy + vs * 0.35, texts[i], vs, { fill: wst ? C.ambTx : '#334155', bold: wst }));
			y += rh;
		}
		svg.appendChild(S(doc, 'line', { x1: r2(x0), y1: r2(top), x2: r2(x0), y2: r2(y), stroke: '#94A3B8', 'stroke-width': 0.8 }));
		return svg;
	}
	/* overall score ring */
	function ring(doc, st, val, txt){
		var d = st.ring, sw = st.ringW, r = (d - sw) / 2 - 0.5, cx = d / 2, cy = d / 2, circ = 2 * Math.PI * r;
		var svg = svgBox(doc, d, d), f = (val === null || isNaN(val)) ? 0 : Math.max(0, Math.min(100, val)) / 100;
		svg.appendChild(S(doc, 'circle', { cx: r2(cx), cy: r2(cy), r: r2(r), fill: 'none', stroke: C.track, 'stroke-width': r2(sw) }));
		if(f > 0) svg.appendChild(S(doc, 'circle', { cx: r2(cx), cy: r2(cy), r: r2(r), fill: 'none', stroke: C.teal, 'stroke-width': r2(sw), 'stroke-linecap': f < 1 ? 'round' : 'butt',
			'stroke-dasharray': r2(circ * f) + ' ' + r2(circ), transform: 'rotate(-90 ' + r2(cx) + ' ' + r2(cy) + ')' }));
		svg.appendChild(T(doc, cx, cy + d * 0.075, txt, d * 0.215, { anchor: 'middle', bold: true, fill: C.brandDk, font: FONT_H }));
		return svg;
	}
	function sq(doc, color, cls){ var s = svgBox(doc, 8, 8); s.setAttribute('class', cls || 'sq'); s.appendChild(S(doc, 'rect', { x: 0.5, y: 1, width: 7, height: 6, rx: 1.4, fill: color })); return s; }
	function dot(doc, color, cls){ var s = svgBox(doc, 8, 8); s.setAttribute('class', cls || 'dot'); s.appendChild(S(doc, 'circle', { cx: 4, cy: 4, r: 3.7, fill: color })); return s; }

	/* ---------- sections ---------- */
	function headSection(doc, host, st){
		var sec = E(doc, 'div', 'sec'), band = E(doc, 'div', 'band');
		band.appendChild(E(doc, 'div', 'eyebrow', 'DQA Desk Review · 2-pager'));
		band.appendChild(E(doc, 'div', 'title', 'Data Template for Data Quality Assessment (DQA) Analysis – ' + D.tool));
		var chips = E(doc, 'div', 'chips');
		[['Name of State', D.state, ''], ['District', D.district, ''], ['Period', D.period, 'wide'], [cap(unit), D.den, 'num'], ['Blocks', D.blocks, 'num']].forEach(function(x){
			var ch = E(doc, 'div', 'chip' + (x[2] ? ' ' + x[2] : ''));
			ch.appendChild(E(doc, 'span', 'k', x[0])); ch.appendChild(E(doc, 'span', 'v', x[1]));
			chips.appendChild(ch);
		});
		band.appendChild(chips);
		sec.appendChild(band);
		if(D.selection && D.selection.length) sec.appendChild(E(doc, 'div', 'sel', 'Selection: ' + D.selection.join(' · ')));
		if(D.chk && D.chk.length) sec.appendChild(E(doc, 'div', 'chk', 'Check failed: the units counted for ' + D.chk.join(', ') + ' differ from the card. Please report this to the DQA team.'));
		host.appendChild(sec);
		return sec;
	}
	function heroSection(doc, host, st){
		var sec = E(doc, 'div', 'sec'), row = E(doc, 'div', 'hero');
		var ov = E(doc, 'div', 'ovr'), num = (D.overall === null) ? null : parseFloat(D.overall);
		ov.appendChild(ring(doc, st, num, D.overall === null ? '—' : D.overall + '%'));
		ov.appendChild(E(doc, 'div', 'ol', 'Overall Score'));
		row.appendChild(ov);
		var tiles = E(doc, 'div', 'tiles');
		tiles.style.gridTemplateColumns = 'repeat(' + Math.max(1, D.comps.length) + ', minmax(0, 1fr))';
		D.comps.forEach(function(c){
			var col = compColor(c.id), t = E(doc, 'div', 'tile');
			t.style.borderTopColor = col;
			t.appendChild(E(doc, 'div', 'tn', c.name));
			var sc = E(doc, 'div', 'ts', c.score === null ? '—' : c.score + '%'); sc.style.color = col; t.appendChild(sc);
			var bar = E(doc, 'div', 'tbar'), fill = E(doc, 'span');
			fill.style.width = (c.score === null ? 0 : Math.max(0, Math.min(100, parseFloat(c.score)))) + '%'; fill.style.background = col;
			bar.appendChild(fill); t.appendChild(bar);
			t.appendChild(E(doc, 'div', 'tw', 'Top issue: ' + (c.worst ? c.worst.pct : (c.score === null ? '—' : '0.0')) + '%'));
			tiles.appendChild(t);
		});
		row.appendChild(tiles);
		sec.appendChild(row);
		host.appendChild(sec);
		return sec;
	}
	function findingsSection(doc, host, st){
		var sec = E(doc, 'div', 'sec'), kf = E(doc, 'div', 'kf'), ul = E(doc, 'ul');
		kf.appendChild(E(doc, 'div', 'kh', 'Key Findings'));
		D.comps.forEach(function(c){
			var li = E(doc, 'li'), col = compColor(c.id);
			li.appendChild(dot(doc, col, 'kdot'));
			var nm = E(doc, 'b', 'kn', c.name + ':'); nm.style.color = col; li.appendChild(nm);
			li.appendChild(doc.createTextNode(' '));
			if(c.worst){
				li.appendChild(E(doc, 'b', null, c.worst.pct + '% ' + unit + ' (' + c.worst.n + ')'));
				li.appendChild(doc.createTextNode(' flagged for ' + joinNames(c.worst.names) + '.'));
			} else {
				li.appendChild(E(doc, 'b', null, '0.0% ' + unit + ' (0)'));
				li.appendChild(doc.createTextNode(' flagged: no issue found in this component.'));
			}
			ul.appendChild(li);
		});
		kf.appendChild(ul); sec.appendChild(kf);
		host.appendChild(sec);
		return sec;
	}
	function issuesSection(doc, M, host, st, ext){
		var sec = E(doc, 'div', 'sec'), box = E(doc, 'div', 'card'), hd = E(doc, 'div', 'chd');
		hd.appendChild(E(doc, 'span', 'ctt', 'Number of Data Quality Issues Identified'));
		hd.appendChild(E(doc, 'span', 'csub', 'KPIs with at least one flagged ' + unitOne + ', by block (out of ' + D.kpiCount + ' KPIs)'));
		box.appendChild(hd); sec.appendChild(box); host.appendChild(sec);
		var w = box.clientWidth / PX - 2 * st.pad - 1.5, rows = D.blockRows;
		box.appendChild(vchart(doc, M, { w: w, labels: rows.map(function(r){ return r.b; }), vals: rows.map(function(r){ return r.types; }),
			color: C.brand, yAxis: true, yLbl: st.yLbl, valSize: st.xVal + 0.8, valFill: C.brandDk, valBold: true, lblSize: st.xLbl + 0.6,
			plotH: st.issH + (ext || 0), barMax: 20, barRatio: 0.42, baseColor: '#94A3B8', maxLines: 2 }));
		return sec;
	}
	function compSection(doc, M, host, c, st, ext){
		var col = compColor(c.id), sec = E(doc, 'div', 'sec'), card = E(doc, 'div', 'card comp');
		card.style.borderLeftColor = col;
		var hd = E(doc, 'div', 'compH'), nm = E(doc, 'span', 'cn', c.name + ': '), sc = E(doc, 'span', 'cs', c.score === null ? '—' : c.score + '%');
		sc.style.color = col; nm.appendChild(sc); hd.appendChild(nm);
		if(c.worst){ var lg = E(doc, 'span', 'leg'); lg.appendChild(sq(doc, C.amber, 'lsq')); lg.appendChild(doc.createTextNode('Top issue')); hd.appendChild(lg); }
		card.appendChild(hd);
		var row = E(doc, 'div', 'charts'), Lc = E(doc, 'div', 'cl'), Rc = E(doc, 'div', 'cr');
		var lt = E(doc, 'div', 'ct', 'Number of Flagged ' + unit), rt = E(doc, 'div', 'ct');
		rt.appendChild(doc.createTextNode('Top issue across blocks:'));
		rt.appendChild(doc.createElement('br'));
		var kn = E(doc, 'span', 'wk');
		if(c.worst){ kn.appendChild(sq(doc, C.amber, 'wdot')); kn.appendChild(doc.createTextNode(c.worst.chart)); }
		else kn.appendChild(doc.createTextNode('No ' + unitOne + ' flagged'));
		rt.appendChild(kn);
		Lc.appendChild(lt); Rc.appendChild(rt); row.appendChild(Lc); row.appendChild(Rc); card.appendChild(row); sec.appendChild(card);
		host.appendChild(sec);   /* measured at its real width */
		var ltH = lt.getBoundingClientRect().height / PX, rtH = rt.getBoundingClientRect().height / PX;
		var lw = Lc.getBoundingClientRect().width / PX, rw = Rc.getBoundingClientRect().width / PX;
		var items = c.kpis.map(function(k){ return { name: k.name, n: k.n, pct: k.pct, worst: !!k.worst }; });
		var left = hchart(doc, M, { w: lw, items: items, H: 0, color: col }, st), right = null, ro = null;
		if(c.worst){
			ro = { w: rw, labels: c.worst.blocks.map(function(b){ return b.b; }), vals: c.worst.blocks.map(function(b){ return b.n; }),
				color: col, yAxis: false, yLbl: st.yLbl, valSize: st.xVal, valFill: C.ink, valBold: true, lblSize: st.xLbl, plotH: st.impH, barMax: 15, barRatio: 0.56, baseColor: '#94A3B8', maxLines: 2 };
			right = vchart(doc, M, ro);
		}
		var lH = ltH + svgH(left), rH = rtH + (right ? svgH(right) : 0), target = Math.max(lH, rH, st.minH) + (ext || 0);
		if(target > lH + 0.5) left = hchart(doc, M, { w: lw, items: items, H: target - ltH, color: col }, st);
		if(right && target > rH + 0.5){ ro.plotH += target - rH; right = vchart(doc, M, ro); }
		if(!right){ right = E(doc, 'div', 'none', 'No ' + unitOne + ' flagged in this component.'); right.style.height = pt(target - rtH); }
		Lc.appendChild(left); Rc.appendChild(right);
		return sec;
	}
	function pill(doc, n, kind){
		var td = E(doc, 'td', 'c');
		if(+n > 0){ var p = E(doc, 'span', 'pill ' + kind, n); td.appendChild(p); } else td.appendChild(E(doc, 'span', 'zero', n));
		return td;
	}
	function blockSpec(doc){
		var rows = D.blockRows;
		return { title: 'Block wise ' + unitOne + ' wise issues identified', cls: 'bt', cols: [24, 13.5, 13.5, 13.5, 13.5, 22], n: rows.length,
			head: function(){
				var tr = E(doc, 'tr');
				tr.appendChild(E(doc, 'th', null, 'Block'));
				[[C.red, '4+ Issues'], [C.amb, '1-3 Issues'], [C.grn, 'No Issues (0)']].forEach(function(x){
					var th = E(doc, 'th', 'c'); th.appendChild(dot(doc, x[0])); th.appendChild(doc.createTextNode(x[1])); tr.appendChild(th);
				});
				tr.appendChild(E(doc, 'th', 'c', 'Total ' + titleCase(unit)));
				tr.appendChild(E(doc, 'th', 'c', 'Distribution'));
				return tr;
			},
			row: function(i){
				var r = rows[i], tr = E(doc, 'tr');
				tr.appendChild(E(doc, 'td', 'blk', r.b)); tr.appendChild(pill(doc, r.g4, 'r')); tr.appendChild(pill(doc, r.g13, 'a'));
				tr.appendChild(pill(doc, r.g0, 'g')); tr.appendChild(E(doc, 'td', 'c b', r.tot)); tr.appendChild(shareCell(doc, r));
				return tr;
			},
			total: function(){
				var t = D.totals, tr = E(doc, 'tr', 'tot');
				tr.appendChild(E(doc, 'td', null, 'Overall Total')); tr.appendChild(E(doc, 'td', 'c', t.g4)); tr.appendChild(E(doc, 'td', 'c', t.g13));
				tr.appendChild(E(doc, 'td', 'c', t.g0)); tr.appendChild(E(doc, 'td', 'c', t.tot)); tr.appendChild(shareCell(doc, t));
				return tr;
			} };
	}
	/* share of 4+ / 1-3 / 0 in the block (a picture of the three counts on the left) */
	function shareCell(doc, r){
		var td = E(doc, 'td', 'sh'), bar = E(doc, 'div', 'sbar'), tot = (+r.g4 || 0) + (+r.g13 || 0) + (+r.g0 || 0);
		[[r.g4, C.red], [r.g13, C.amb], [r.g0, C.grn]].forEach(function(x){
			if(!(tot > 0) || !(+x[0] > 0)) return;
			var s = E(doc, 'span'); s.style.width = r2(100 * (+x[0]) / tot) + '%'; s.style.background = x[1]; bar.appendChild(s);
		});
		td.appendChild(bar);
		return td;
	}
	/* the same table in two halves side by side (many blocks): left half, then right half + Overall Total */
	function blockSplitSection(doc, host){
		var spec = blockSpec(doc), rows = D.blockRows, n = rows.length, half = Math.ceil(n / 2);
		var sec = E(doc, 'div', 'sec'), hd = E(doc, 'div', 'tth');
		hd.appendChild(E(doc, 'span', 'ttt', spec.title));
		sec.appendChild(hd);
		var wrapEl = E(doc, 'div', 'split');
		[[0, half], [half, n]].forEach(function(rg, side){
			var t = E(doc, 'table', 'bt bs'), cg = E(doc, 'colgroup'), th = E(doc, 'thead'), tb = E(doc, 'tbody');
			[34, 16.5, 16.5, 16.5, 16.5].forEach(function(w){ var c = E(doc, 'col'); c.style.width = w + '%'; cg.appendChild(c); });
			var tr = spec.head(); tr.removeChild(tr.lastChild); th.appendChild(tr);
			for(var i = rg[0]; i < rg[1]; i++){ var r = spec.row(i); r.removeChild(r.lastChild); tb.appendChild(r); }
			if(side === 1){ var tt = spec.total(); tt.removeChild(tt.lastChild); tb.appendChild(tt); }
			t.appendChild(cg); t.appendChild(th); t.appendChild(tb);
			wrapEl.appendChild(t);
		});
		sec.appendChild(wrapEl);
		host.appendChild(sec);
		return sec;
	}
	function topSpec(doc){
		var rows = D.blockRows;
		return { title: 'Top 3 ' + titleCase(unit) + ' to focus in each block', cls: 'bt t3', cols: [21, 26.3, 26.3, 26.4], n: rows.length,
			head: function(){ var tr = E(doc, 'tr'); ['Block', '1st Highest', '2nd Highest', '3rd Highest'].forEach(function(h){ tr.appendChild(E(doc, 'th', null, h)); }); return tr; },
			row: function(i){
				var r = rows[i], tr = E(doc, 'tr');
				tr.appendChild(E(doc, 'td', 'blk', r.b));
				for(var j = 0; j < 3; j++){
					var u = r.top[j], td = E(doc, 'td');
					if(u){ td.appendChild(doc.createTextNode(u.u + ' ')); td.appendChild(E(doc, 'span', 'cnt', '(' + u.n + ')')); }
					else td.appendChild(E(doc, 'span', 'zero', '—'));
					tr.appendChild(td);
				}
				return tr;
			},
			total: null };
	}
	function tableSection(doc, host, spec){
		var sec = E(doc, 'div', 'sec'), hd = E(doc, 'div', 'tth');
		hd.appendChild(E(doc, 'span', 'ttt', spec.title));
		sec.appendChild(hd);
		var t = E(doc, 'table', spec.cls), cg = E(doc, 'colgroup'), th = E(doc, 'thead'), tb = E(doc, 'tbody');
		spec.cols.forEach(function(w){ var c = E(doc, 'col'); c.style.width = w + '%'; cg.appendChild(c); });
		th.appendChild(spec.head());
		for(var i = 0; i < spec.n; i++) tb.appendChild(spec.row(i));
		if(spec.total) tb.appendChild(spec.total());
		t.appendChild(cg); t.appendChild(th); t.appendChild(tb);
		sec.appendChild(t);
		host.appendChild(sec);
		return sec;
	}

	function stamp(){
		var d = new Date(), m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		function z(x){ return (x < 10 ? '0' : '') + x; }
		return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear() + ', ' + z(d.getHours()) + ':' + z(d.getMinutes());
	}
	function css(st){
		var p = pt;
		return '@page{size:A4 portrait;margin:0}' +
		'*{box-sizing:border-box}html,body{margin:0;padding:0}' +
		'body{background:#c9ced6;color:' + C.ink + ';font-family:' + FONT + ';-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
		'.tb{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:9px 16px;background:' + C.brand + ';color:#fff;font:13px/1.4 system-ui,"Segoe UI",Arial,sans-serif}' +
		'.tb b{font-size:14px}.tb button{font:inherit;font-weight:700;padding:6px 16px;border:0;border-radius:6px;background:' + C.amber + ';color:#111;cursor:pointer}' +
		'#pages{padding:16px 0 2px}' +
		'.page{position:relative;width:210mm;height:' + r2(PG_H) + 'pt;margin:0 auto 16px;padding:' + MT + 'pt ' + ML + 'pt 0;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.28);overflow:hidden}' +
		'.page:before{content:"";position:absolute;left:0;right:0;top:0;height:5pt;background:' + C.brand + '}' +
		'.page:after{content:"";position:absolute;left:0;top:0;width:110pt;height:5pt;background:' + C.amber + '}' +
		'.pbody{height:' + r2(CH) + 'pt;overflow:hidden}' +
		'.pfoot{position:absolute;left:' + ML + 'pt;right:' + ML + 'pt;bottom:11pt;display:flex;justify-content:space-between;gap:12pt;border-top:0.6pt solid ' + C.line + ';padding-top:3.5pt;font-size:7.3pt;color:' + C.muted + '}' +
		'.pfoot span:last-child{font-weight:700;color:' + C.brand + ';white-space:nowrap}' +
		'.measure{position:absolute;left:-30000px;top:0;visibility:hidden}' +
		'.sec{display:flow-root;padding-bottom:' + p(st.gap) + '}' +
		'.band{position:relative;overflow:hidden;background:' + C.brand + ';color:#fff;border-radius:7pt;padding:' + p(st.band * 0.85) + ' ' + p(st.band + 1) + ' ' + p(st.band) + '}' +
		'.band:before{content:"";position:absolute;right:-34pt;top:-58pt;width:150pt;height:150pt;border-radius:50%;background:rgba(255,255,255,.07)}' +
		'.band:after{content:"";position:absolute;right:58pt;bottom:-70pt;width:110pt;height:110pt;border-radius:50%;background:rgba(245,158,11,.13)}' +
		'.eyebrow{position:relative;font-size:' + p(st.fsS) + ';letter-spacing:1.5pt;font-weight:700;color:' + C.amberLt + ';text-transform:uppercase}' +
		'.title{position:relative;font-family:' + FONT_H + ';font-size:' + p(st.title) + ';font-weight:700;line-height:1.18;margin:' + p(st.band * 0.16) + ' 0 ' + p(st.band * 0.62) + '}' +
		'.chips{position:relative;display:flex;gap:' + p(st.band * 0.45) + '}' +
		'.chip{flex:1 1 0;min-width:0;background:rgba(255,255,255,.12);border:0.6pt solid rgba(255,255,255,.24);border-radius:5pt;padding:' + p(st.chipPad) + ' ' + p(st.chipPad * 1.9) + '}' +
		'.chip.wide{flex:2.1 1 0}.chip.num{flex:0.8 1 0}' +
		'.chip .k{display:block;font-size:' + p(st.fsS * 0.9) + ';letter-spacing:.7pt;text-transform:uppercase;color:#BFD9E5;white-space:nowrap}' +
		'.chip .v{display:block;font-size:' + p(st.fs + 0.4) + ';font-weight:700;line-height:1.25;color:#fff;overflow-wrap:anywhere}' +
		'.sel{margin:' + p(st.gap * 0.55) + ' 0 0;padding:' + p(st.chipPad) + ' ' + p(st.pad) + ';border-radius:5pt;background:' + C.panel + ';color:#334155;font-size:' + p(st.fsS + 0.6) + '}' +
		'.chk{margin-top:' + p(st.gap * 0.55) + ';padding:3pt 7pt;border:0.8pt solid ' + C.redTx + ';border-radius:5pt;color:' + C.redTx + ';font-size:' + p(st.fs) + ';font-weight:700}' +
		'.hero{display:flex;gap:' + p(st.pad * 0.8) + ';align-items:stretch}' +
		'.ovr{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:' + p(st.pad * 0.6) + ' ' + p(st.pad * 1.3) + ';border:0.7pt solid ' + C.line + ';border-radius:7pt;background:' + C.panel2 + '}' +
		'.ol{margin-top:' + p(st.pad * 0.35) + ';font-size:' + p(st.fsS + 0.2) + ';font-weight:700;letter-spacing:.8pt;text-transform:uppercase;color:' + C.brand + ';white-space:nowrap}' +
		'.tiles{flex:1 1 auto;min-width:0;display:grid;gap:' + p(st.pad * 0.7) + '}' +
		'.tile{min-width:0;border:0.7pt solid ' + C.line + ';border-top:3.2pt solid ' + C.brand + ';border-radius:6pt;padding:' + p(st.pad * 0.75) + ' ' + p(st.pad) + ';background:#fff;display:flex;flex-direction:column;justify-content:center}' +
		'.tn{font-size:' + p(st.fsS) + ';font-weight:700;letter-spacing:.8pt;text-transform:uppercase;color:' + C.muted + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
		'.ts{font-family:' + FONT_H + ';font-size:' + p(st.tile) + ';font-weight:700;line-height:1.08;margin:' + p(st.pad * 0.2) + ' 0 ' + p(st.pad * 0.35) + '}' +
		'.tile .tbar{height:' + p(L(4.2, 3, st.c)) + ';border-radius:3pt;background:' + C.track + ';overflow:hidden}' +
		'.tile .tbar span{display:block;height:100%;border-radius:3pt}' +
		'.tw{margin-top:' + p(st.pad * 0.4) + ';font-size:' + p(st.fsS) + ';color:' + C.muted + ';white-space:nowrap}' +
		'.kf{position:relative;border-radius:7pt;background:' + C.panel + ';border-left:3.4pt solid ' + C.teal + ';padding:' + p(st.pad * 0.75) + ' ' + p(st.pad * 1.2) + ' ' + p(st.pad * 0.8) + '}' +
		'.kh{font-family:' + FONT_H + ';font-size:' + p(st.h2) + ';font-weight:700;color:' + C.brand + ';margin-bottom:' + p(st.pad * 0.3) + '}' +
		'.kf ul{list-style:none;margin:0;padding:0}' +
		'.kf li{position:relative;padding-left:' + p(st.kf * 1.25) + ';margin:' + p(st.pad * 0.12) + ' 0;font-size:' + p(st.kf) + ';line-height:1.32}' +
		'.kdot{position:absolute;left:0;top:' + p(st.kf * 0.36) + ';width:' + p(st.kf * 0.62) + ';height:' + p(st.kf * 0.62) + '}' +
		'.card{border:0.7pt solid ' + C.line + ';border-radius:7pt;padding:' + p(st.pad * 0.8) + ' ' + p(st.pad) + ' ' + p(st.pad * 0.55) + ';background:#fff}' +
		'.chd{display:flex;align-items:baseline;gap:8pt;flex-wrap:wrap;margin-bottom:' + p(st.pad * 0.25) + '}' +
		'.ctt{font-family:' + FONT_H + ';font-size:' + p(st.h2) + ';font-weight:700;color:' + C.brand + '}' +
		'.csub{font-size:' + p(st.fsS) + ';color:' + C.muted + '}' +
		'.card.comp{border-left:4pt solid ' + C.brand + ';padding-left:' + p(st.pad * 0.9) + '}' +
		'.compH{display:flex;align-items:baseline;justify-content:space-between;gap:8pt;margin-bottom:' + p(st.pad * 0.3) + '}' +
		'.leg{font-size:' + p(st.fsS) + ';color:' + C.muted + ';white-space:nowrap}.lsq{display:inline-block;vertical-align:-0.6pt;margin-right:3pt;width:' + p(st.fsS + 0.6) + ';height:' + p(st.fsS + 0.6) + '}' +
		'.cn{font-family:' + FONT_H + ';font-size:' + p(st.h2 + 0.4) + ';font-weight:700;color:' + C.ink + '}' +
		'.charts{display:flex;gap:' + p(st.pad * 1.1) + ';align-items:flex-start}.cl{flex:0 0 48%;width:48%;min-width:0}.cr{flex:1 1 auto;min-width:0}' +
		'.ct{text-align:center;font-size:' + p(st.ct) + ';line-height:1.25;color:#334155;font-weight:700}' +
		'.wk{font-weight:400;color:' + C.ink + '}.wdot{display:inline-block;vertical-align:0;margin-right:3pt;width:' + p(st.ct * 0.62) + ';height:' + p(st.ct * 0.62) + '}' +
		'.none{display:flex;align-items:center;justify-content:center;text-align:center;font-size:' + p(st.fs) + ';color:' + C.muted + '}' +
		'svg{display:block;overflow:visible}' +
		'.tth{margin:0 0 ' + p(st.pad * 0.45) + ';display:flex;align-items:center;gap:6pt}' +
		'.tth:before{content:"";width:3.4pt;align-self:stretch;border-radius:2pt;background:' + C.amber + '}' +
		'.ttt{font-family:' + FONT_H + ';font-size:' + p(st.h2) + ';font-weight:700;color:' + C.brand + '}' +
		'table{border-collapse:separate;border-spacing:0;table-layout:fixed;width:100%}' +
		'table.bt{font-size:' + p(st.tFs) + ';color:' + C.ink + ';border:0.7pt solid ' + C.line + ';border-radius:6pt;overflow:hidden}' +
		'table.bt th,table.bt td{padding:' + p(st.tPad) + ' ' + p(L(5, 3.2, st.c)) + ';vertical-align:middle;overflow-wrap:anywhere;border-bottom:0.5pt solid ' + C.line + '}' +
		'table.bt tbody tr:last-child td{border-bottom:0}' +
		'table.bt thead th{background:' + C.brand + ';color:#fff;font-weight:700;text-align:left;border-bottom:0}' +
		'table.bt tbody tr:nth-child(even) td{background:' + C.panel2 + '}' +
		'table.bt .c{text-align:center}table.bt thead th.c{text-align:center}table.bt td.b{font-weight:700}' +
		'table.bt td.blk{font-weight:700;color:' + C.brandDk + '}' +
		'table.bt tr.tot td{background:' + C.tot + ';font-weight:700;color:' + C.brandDk + ';border-top:1pt solid ' + C.brand + '}' +
		'.pill{display:inline-block;min-width:' + p(st.tFs * 2.1) + ';padding:0 ' + p(st.tFs * 0.45) + ';border-radius:' + p(st.tFs) + ';font-weight:700;line-height:1.45}' +
		'.pill.r{background:' + C.redBg + ';color:' + C.redTx + '}.pill.a{background:' + C.ambBg + ';color:' + C.ambTx + '}.pill.g{background:' + C.grnBg + ';color:' + C.grnTx + '}' +
		'.zero{color:#94A3B8}' +
		'td.sh{padding-right:' + p(L(7, 4, st.c)) + '}.sbar{display:flex;height:' + p(L(6.5, 4.5, st.c)) + ';border-radius:3pt;overflow:hidden;background:' + C.track + '}.sbar span{display:block;height:100%}' +
		'.split{display:flex;gap:' + p(st.pad) + ';align-items:flex-start}.split table{flex:1 1 0;min-width:0;width:auto}' +
		'table.t3 td{padding-top:' + p(st.t3Pad) + ';padding-bottom:' + p(st.t3Pad) + '}' +
		'table.t3 td.blk{background:' + C.panel + '}table.t3 tbody tr:nth-child(even) td.blk{background:#E4EFF4}' +
		'.cnt{font-weight:700;color:' + C.teal + ';white-space:nowrap}' +
		'svg.dot{display:inline-block;vertical-align:-0.4pt;margin-right:3pt;width:7pt;height:7pt}' +
		'@media print{body{background:#fff}.tb{display:none}#pages{padding:0}.page{margin:0;box-shadow:none;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}}';
	}

	/* ---------- the two pages ---------- */
	function build(win, isFrame){
		var doc = win.document;
		var bar = isFrame ? '' : ('<div class="tb"><b>DQA 2-pager – ' + esc(D.tool) + '</b><button type="button" onclick="window.print()">Save as PDF / Print</button>' +
			'<span id="tbInfo">A4 portrait</span><span>In the print window choose “Save as PDF” as the destination, then Save.</span></div>');
		doc.open();
		doc.write('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + esc(D.file) + '</title><style id="dqa2pCss"></style></head><body>' +
			bar + '<div id="pages"></div></body></html>');
		doc.close();
		var M = measurer(doc), styleEl = doc.getElementById('dqa2pCss'), pagesEl = doc.getElementById('pages');
		var cap = CH * PX - 1;
		/* all sections built at level c in a hidden box of the given width (pt) */
		function make(c, widthPt, ext, o){
			var st = sty(c);
			ext = ext || { iss: 0, comps: [] };
			o = o || {};
			styleEl.textContent = css(st);
			var host = E(doc, 'div', 'measure'); host.style.width = pt(widthPt || CW); doc.body.appendChild(host);
			var s = { c: c, st: st, host: host };
			s.fixed = [headSection(doc, host, st), heroSection(doc, host, st), findingsSection(doc, host, st), issuesSection(doc, M, host, st, ext.iss)];
			s.comps = D.comps.map(function(cc, j){ return compSection(doc, M, host, cc, st, ext.comps[j] || 0); });
			s.tables = [o.split ? blockSplitSection(doc, host) : tableSection(doc, host, blockSpec(doc)), tableSection(doc, host, topSpec(doc))];
			return s;
		}
		function drop(s){ if(s && s.host && s.host.parentNode) s.host.parentNode.removeChild(s.host); }
		function hOf(el){ return el.getBoundingClientRect().height; }
		/* which components go on page 1 (as many as fit), the rest + both tables on page 2 */
		function plan(s){
			var i, k, H1 = 0, hc = s.comps.map(hOf), HT = hOf(s.tables[0]) + hOf(s.tables[1]), K = hc.length;
			for(i = 0; i < s.fixed.length; i++) H1 += hOf(s.fixed[i]);
			function sums(k){ var a = H1, b = HT; for(i = 0; i < k; i++) a += hc[i]; for(i = k; i < K; i++) b += hc[i]; return [a, b]; }
			for(k = K; k >= 0; k--){ var q = sums(k); if(q[0] <= cap && q[1] <= cap) return { ok: true, k: k, h: q }; }
			for(k = K; k > 0; k--){ if(sums(k)[0] <= cap) break; }
			return { ok: false, k: k, h: sums(k) };
		}
		/* the roomiest level at which everything fits on two pages */
		function solve(o){
			var s0 = make(0, CW, null, o), p0 = plan(s0);
			if(p0.ok) return { s: s0, p: p0, o: o };
			drop(s0);
			var s1 = make(1, CW, null, o), p1 = plan(s1);
			if(!p1.ok) return { s: s1, p: p1, o: o };
			drop(s1);
			var lo = 0, hi = 1;
			for(var it = 0; it < 7; it++){
				var mid = (lo + hi) / 2, sm = make(mid, CW, null, o), pm = plan(sm);
				drop(sm);
				if(pm.ok) hi = mid; else lo = mid;
			}
			var sh = make(hi, CW, null, o);
			return { s: sh, p: plan(sh), o: o };
		}
		var R = solve({ split: false });
		if(!R.p.ok && D.blockRows.length > 6){
			var R2 = solve({ split: true });
			if(R2.p.ok || R2.p.h[1] < R.p.h[1]){ drop(R.s); R = R2; } else drop(R2.s);
		}
		var s = R.s, p = R.p, opt = R.o;
		/* spare room on a page goes to its charts (a little taller each), so no page ends half empty */
		function share(amount, caps){
			var out = caps.map(function(){ return 0; }), left = amount, open = caps.map(function(c, j){ return j; });
			for(var g = 0; g < 8 && left > 0.5 && open.length; g++){
				var each = left / open.length, next = [];
				open.forEach(function(j){ var add = Math.min(each, caps[j] - out[j]); out[j] += add; left -= add; if(caps[j] - out[j] > 0.01) next.push(j); });
				open = next;
			}
			return out;
		}
		if(p.ok){
			var K = D.comps.length, room1 = (cap - p.h[0]) / PX - 2, room2 = (cap - p.h[1]) / PX - 2, j;
			var caps1 = [36].concat(D.comps.slice(0, p.k).map(function(){ return 44; }));
			var caps2 = D.comps.slice(p.k).map(function(){ return 30; });
			var g1 = room1 > 2 ? share(room1, caps1) : caps1.map(function(){ return 0; });
			var g2 = (room2 > 2 && caps2.length) ? share(room2, caps2) : caps2.map(function(){ return 0; });
			var ext = { iss: g1[0], comps: [] };
			for(j = 0; j < K; j++) ext.comps.push(j < p.k ? g1[j + 1] : g2[j - p.k]);
			if(g1.concat(g2).some(function(v){ return v > 0.5; })){
				var sx = make(s.c, CW, ext, opt), px2 = plan(sx);
				if(px2.ok && px2.k === p.k){ drop(s); s = sx; p = px2; } else drop(sx);
			}
		}
		var pages = [];
		function newPage(){
			var pg = E(doc, 'div', 'page'), body = E(doc, 'div', 'pbody'), pin = E(doc, 'div', 'pin');
			body.appendChild(pin); pg.appendChild(body); pagesEl.appendChild(pg);
			var o = { pg: pg, pin: pin }; pages.push(o); return o;
		}
		var P1 = newPage(), P2 = newPage(), i;
		s.fixed.forEach(function(n){ P1.pin.appendChild(n); });
		for(i = 0; i < s.comps.length; i++) (i < p.k ? P1 : P2).pin.appendChild(s.comps[i]);
		s.tables.forEach(function(n){ P2.pin.appendChild(n); });
		drop(s);
		/* rare (very many blocks or KPIs): a page still too long is drawn wider and scaled down to fit */
		function fitPage(P, which){
			var h = hOf(P.pin);
			if(h <= cap) return;
			var w = CW, sc = cap / h, got = null;
			for(var t = 0; t < 4; t++){
				w = CW / sc;
				if(got) drop(got);
				got = make(s.c, w, null, opt);
				var nodes = which === 1 ? got.fixed.concat(got.comps.slice(0, p.k)) : got.comps.slice(p.k).concat(got.tables), hh = 0;
				for(var j = 0; j < nodes.length; j++) hh += hOf(nodes[j]);
				var ns = Math.min(cap / hh, CW / w);
				if(Math.abs(ns - sc) < 0.002){ sc = ns; break; }
				sc = ns;
			}
			while(P.pin.firstChild) P.pin.removeChild(P.pin.firstChild);
			var nodes2 = which === 1 ? got.fixed.concat(got.comps.slice(0, p.k)) : got.comps.slice(p.k).concat(got.tables);
			var inner = E(doc, 'div', 'scaled');
			inner.style.width = pt(w); inner.style.transformOrigin = '0 0'; inner.style.transform = 'scale(' + r2(sc * 1000) / 1000 + ')';
			nodes2.forEach(function(n){ inner.appendChild(n); });
			var box = E(doc, 'div', 'scbox');
			box.appendChild(inner); P.pin.appendChild(box);
			box.style.height = Math.ceil(inner.offsetHeight * sc) + 'px'; box.style.overflow = 'hidden';
			drop(got);
		}
		styleEl.textContent = css(s.st);
		fitPage(P1, 1); fitPage(P2, 2);
		styleEl.textContent = css(s.st);
		var st0 = stamp(), N = pages.length, dist = (D.district && D.district !== '—') ? ' · ' + D.district : '';
		pages.forEach(function(pg, i){
			var f = E(doc, 'div', 'pfoot');
			f.appendChild(E(doc, 'span', null, 'DQA Desk Review – ' + D.tool + dist + ' · ' + D.periodShort + ' · Generated ' + st0));
			f.appendChild(E(doc, 'span', null, 'Page ' + (i + 1) + ' of ' + N));
			pg.pg.appendChild(f);
		});
		var info = doc.getElementById('tbInfo');
		if(info) info.textContent = 'A4 portrait · ' + N + ' pages';
		setTimeout(function(){ try{ win.focus(); win.print(); }catch(e){} }, 350);
	}
	function openReport(){
		if(!(D.den > 0)){ alert('No ' + unitOne + ' is under the current filters, so there is nothing to report. Widen the filters and press Apply Filter.'); return; }
		var w = null;
		try{ w = window.open('', '_blank'); }catch(e){ w = null; }
		if(w){
			try{ build(w, false); return; }catch(e){ if(window.console) console.error(e); try{ w.close(); }catch(e2){} }
		}
		try{   /* pop-up blocked: print through a hidden frame */
			var old = document.getElementById('dqa2pFrame');
			if(old) old.parentNode.removeChild(old);
			var fr = document.createElement('iframe');
			fr.id = 'dqa2pFrame'; fr.setAttribute('aria-hidden', 'true'); fr.setAttribute('tabindex', '-1');
			fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0;visibility:hidden;';
			document.body.appendChild(fr);
			build(fr.contentWindow, true);
		}catch(e3){ if(window.console) console.error(e3); alert('Unable to prepare the 2-pager. Please try again.'); }
	}
	/* the button: a very small unlabelled dot at the top left of the page (meant for the few users who
	   need the report, so it is deliberately hard to notice; above the Overall Score page too) */
	var b = document.createElement('button');
	b.type = 'button'; b.id = 'dqa2pBtn';
	b.setAttribute('tabindex', '-1'); b.setAttribute('aria-hidden', 'true');
	b.style.cssText = 'position:absolute;left:3px;top:3px;z-index:100000;display:block;width:8px;height:8px;min-width:0;min-height:0;margin:0;padding:0;' +
		'border:0;border-radius:50%;background:#64748b;opacity:.28;box-shadow:none;outline:none;transform:none;transition:none;font-size:0;line-height:0;cursor:pointer;';
	b.addEventListener('mouseenter', function(){ b.style.opacity = '.7'; });
	b.addEventListener('mouseleave', function(){ b.style.opacity = '.28'; });
	b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); openReport(); });
	document.body.appendChild(b);
	var ps = document.createElement('style');
	ps.textContent = '@media print{#dqa2pBtn{display:none !important}}';
	(document.head || document.body).appendChild(ps);
})();
</script>
<?php dqa_idle_script(); ?>
</body>
</html>
<?php
}
