


<?php
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



$APP_NAME = "UWIN Data Quality Assessment - Desk Review";
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

session_start();

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
function sanitize_number($raw){
	if($raw===null) return 0;
	if(is_int($raw) || is_float($raw)) return $raw + 0;
	$s = strip_bom((string)$raw);
	$s = str_replace(array("\xC2\xA0", "Â "), ' ', $s);
	$s = trim($s);
	if($s==='') return 0;
	$low = function_exists('mb_strtolower') ? mb_strtolower($s,'UTF-8') : strtolower($s);
	if($low==='na' || $low==='n/a' || $low==='null' || $low==='-' ) return 0;
	// Remove thousand separators and stray spaces inside numbers
	$s = str_replace(',', '', $s);
	$s = preg_replace('/(?<=\d)\s+(?=\d)/u','', $s);
	if(is_numeric($s)) return $s + 0;
	if(preg_match('/-?\d+(?:\.\d+)?/u', $s, $m)) return $m[0] + 0;
	return 0;
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
		if(preg_match('/\bbc\b?g\b/u',$p)) return ['code'=>'','short'=>'BCG'];
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

	/* Indicator target map from headers */
	$indicatorIdxTargets = [];
	if($idxMonth !== null){
		for($i=$idxMonth+1;$i<count($header);$i++){
			$detect = detect_target_indicator($header[$i]);
			if($detect){
				$indicatorIdxTargets[$i]=[
					'header'=>$header[$i],
					'short'=>$detect['short'],
					'code'=>$detect['code']
				];
			}
		}
	}

	/* Selected months set */
	$allMonths = isset($_SESSION['allMonthsMap']) ? $_SESSION['allMonthsMap'] : [];
	$selMonthsArr = isset($filters['months']) ? $filters['months'] : [];
	$selMonths = [];
	foreach((array)$selMonthsArr as $mk){ $selMonths[$mk]=true; }

	/* Selected blocks set for export-row filtering */
	$selBlocksArr = isset($filters['blocks']) ? $filters['blocks'] : [];
	$selBlocks = [];
	foreach((array)$selBlocksArr as $bk){ $selBlocks[(string)$bk]=true; }

	/* Restrict highlighted export rows to selected blocks only, same as KPI tables */
	if($idxBlock !== null && !empty($selBlocks)){
		$rowsFiltered = [];
		foreach($rows as $r0){
			if(count($r0)<count($header)) $r0=array_pad($r0,count($header),'');
			$blk0 = isset($r0[$idxBlock]) ? trim((string)$r0[$idxBlock]) : '';
			$blkLabel0 = display_block_label($blk0);
			if(!isset($selBlocks[$blk0]) && !isset($selBlocks[$blkLabel0])) continue;
			$rowsFiltered[] = $r0;
		}
		$rows = $rowsFiltered;
	}

	/* Facility set for this KPI key (block||facility) */
	$facSet = [];
	if(isset($pink_sets[$key]) && is_array($pink_sets[$key])){
		foreach($pink_sets[$key] as $fk){ $facSet[$fk]=true; }
	}

	$find = function($code) use ($header){ return find_index_by_code($header,$code); };

	/* Build full-file output rows */
	$full = [];
	$full[] = $header;
	foreach($rows as $r){
		if(count($r)<count($header)) $r=array_pad($r,count($header),'');
		$full[] = $r;
	}
	$style_map = [];
	$DARK_PINK = "#ff8fb1";

	/* Resolve common indices */
	$iSessP = $find('sessions planned');
	$iSessH = $find('sessions held');
	// UWIN headers are usually "Session Planned" / "Session Held"
	if($iSessP===null) $iSessP = find_col_index_contains_any($header, ['session planned','sessions planned']);
	if($iSessH===null) $iSessH = find_col_index_contains_any($header, ['session held','sessions held']);

	/* Session Site column (for Outliers/Dropouts export highlighting) */
	$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);

	/* NEW: Beneficiaries columns (UWIN sample: columns N–Q) */
	$iBenPW = find_col_index_contains_any($header, ['number of pregnant women vaccinated','pregnant women vaccinated']);
	$iBenInf = find_col_index_contains_any($header, ['number of infants (0-1 year) vaccinated','infants (0-1 year) vaccinated','infants 0-1 year vaccinated']);
	$iBenChild = find_col_index_contains_any($header, ['number of children (>1 year) vaccinated','children (>1 year) vaccinated','children >1 year vaccinated']);
	$iBenAdol = find_col_index_contains_any($header, ['number of adolescents vaccinated','adolescents vaccinated']);

	/* NEW: Td columns (for "Total Beneficiaries vaccinated = 0" KPI export, key 't9') */
	$iBenTd1 = find_col_index_contains_any($header, ['number of women vaccinated with td 1']);
	$iBenTd2 = find_col_index_contains_any($header, ['number of women vaccinated with td 2']);
	$iBenTdB = find_col_index_contains_any($header, ['number of women vaccinated with td-booster','number of women vaccinated with td booster']);
	$iBenTd10 = find_col_index_contains_any($header, ['number of adolescents vaccinated with td10','adolescents vaccinated with td10']);
	$iBenTd16 = find_col_index_contains_any($header, ['number of adolescents vaccinated with td16','adolescents vaccinated with td16']);
	$benZeroIdxList = [];
	foreach([$iBenPW,$iBenInf,$iBenChild,$iBenAdol,$iBenTd1,$iBenTd2,$iBenTdB,$iBenTd10,$iBenTd16] as $biTmp){
		if($biTmp!==null) $benZeroIdxList[] = $biTmp;
	}

	/* For co-admin and other indicator-based highlights */
	$idxByShort = [];
	foreach($indicatorIdxTargets as $ci=>$meta){ $idxByShort[$meta['short']] = $ci; }

	/* For dynamic inconsistencies pairs */
	$incons_pair_map = isset($_SESSION['incons_pair_map']) ? $_SESSION['incons_pair_map'] : [];

	/* Availability export support:
	   - t0 must match only when at least one RAW row itself has all target indicators as 0
	   - t7 continues to use the same facility-month aggregation logic as the KPI/table */
	$availability_group_hits = ['t0'=>[], 't7'=>[], 't9'=>[]];
	$availability_raw_zero_rows = [];
	if(($key === 't0' || $key === 't7' || $key === 't9') && $idxMonth !== null){
		$availabilityAgg = [];
		foreach($rows as $ri0=>$r0){
			if(count($r0) < count($header)) $r0 = array_pad($r0, count($header), '');
			$block0 = ($idxBlock!==null && isset($r0[$idxBlock])) ? trim((string)$r0[$idxBlock]) : '';
			$fac0   = ($idxFac!==null && isset($r0[$idxFac])) ? trim((string)$r0[$idxFac]) : '';
			$sess0  = ($idxSessionSite!==null && isset($r0[$idxSessionSite])) ? trim((string)$r0[$idxSessionSite]) : '';
			$mon0   = ($idxMonth!==null && isset($r0[$idxMonth])) ? (string)$r0[$idxMonth] : '';
			if($block0==='' && $fac0==='') continue;
			if(trim($mon0)==='') continue;
			$mKey0 = month_key($mon0);
			if($mKey0===null) continue;
			$rowKey0 = $block0.'||'.$fac0.'||'.$sess0;

			/* Raw-row zero check for t0.
			   CHANGED: consider ALL columns after the "Session Held" column (beneficiary counts,
			   Td columns and all vaccine columns) — every such column must have a 0 value (not blank).
			   If the Session Held column cannot be resolved, fall back to the target vaccine indicators. */
			$allZeroRaw0 = true; $hasAnyRaw0 = false;
			if($iSessH !== null){
				for($ci0 = $iSessH+1; $ci0 < count($header); $ci0++){
					if($ci0 === $idxMonth) continue; /* skip Month column if it appears after Session Held */
					$v0 = as_num_or_null(isset($r0[$ci0]) ? $r0[$ci0] : null);
					if($v0 === null){ $allZeroRaw0 = false; break; }
					$hasAnyRaw0 = true;
					if((float)$v0 != 0.0){ $allZeroRaw0 = false; break; }
				}
			} else {
				foreach($indicatorIdxTargets as $ci0=>$meta0){
					$v0 = as_num_or_null(isset($r0[$ci0]) ? $r0[$ci0] : null);
					if($v0 === null){ $allZeroRaw0 = false; break; }
					$hasAnyRaw0 = true;
					if((float)$v0 != 0.0){ $allZeroRaw0 = false; break; }
				}
			}
			if($hasAnyRaw0 && $allZeroRaw0){
				$availability_group_hits['t0'][$rowKey0][$mKey0] = true;
				/* FIX: key by $full row index ($full has the header at index 0, so data row N in $rows
				   is row N+1 in $full); previously the hit landed one row off / was missed. */
				$availability_raw_zero_rows[$ri0 + 1] = true;
			}

			if(!isset($availabilityAgg[$rowKey0])) $availabilityAgg[$rowKey0] = [];
			if(!isset($availabilityAgg[$rowKey0][$mKey0])) $availabilityAgg[$rowKey0][$mKey0] = ['sums'=>[], 'has'=>[]];
			for($ci0=$idxMonth+1; $ci0<count($header); $ci0++){
				$v0 = as_num_or_null(isset($r0[$ci0]) ? $r0[$ci0] : null);
				if($v0 !== null){
					if(!isset($availabilityAgg[$rowKey0][$mKey0]['sums'][$ci0])) $availabilityAgg[$rowKey0][$mKey0]['sums'][$ci0] = 0;
					$availabilityAgg[$rowKey0][$mKey0]['sums'][$ci0] += $v0;
					$availabilityAgg[$rowKey0][$mKey0]['has'][$ci0] = true;
				}else{
					if(!isset($availabilityAgg[$rowKey0][$mKey0]['has'][$ci0])) $availabilityAgg[$rowKey0][$mKey0]['has'][$ci0] = false;
				}
			}
		}

		foreach($availabilityAgg as $rowKey0=>$months0){
			foreach($months0 as $mKey0=>$agg0){
				/* t7: same logic as Availability KPI/table -> all columns after Month */
				$firstVal = null; $ok = true; $hasAny = false;
				for($ci0=$idxMonth+1; $ci0<count($header); $ci0++){
					if(!isset($agg0['has'][$ci0]) || !$agg0['has'][$ci0]){ $ok = false; break; }
					$v0 = isset($agg0['sums'][$ci0]) ? $agg0['sums'][$ci0] : null;
					if($v0 === null){ $ok = false; break; }
					if((float)$v0 == 0.0){ $ok = false; break; }
					$vv0 = sprintf('%.10F', (float)$v0);
					if($firstVal === null){ $firstVal = $vv0; $hasAny = true; }
					elseif($vv0 !== $firstVal){ $ok = false; break; }
				}
				if($hasAny && $ok){
					$availability_group_hits['t7'][$rowKey0][$mKey0] = true;
				}

				/* t9: total of beneficiary indicators (PW/Infants/Children/Adolescents/Td 1/Td 2/Td-Booster/td10/td16) = 0 on sums */
				if(!empty($benZeroIdxList)){
					$benSum0 = 0.0; $benHas0 = false;
					foreach($benZeroIdxList as $bi0){
						if(isset($agg0['has'][$bi0]) && $agg0['has'][$bi0]){
							$benHas0 = true;
							$benSum0 += (float)(isset($agg0['sums'][$bi0]) ? $agg0['sums'][$bi0] : 0);
						}
					}
					if($benHas0 && $benSum0 == 0.0){
						$availability_group_hits['t9'][$rowKey0][$mKey0] = true;
					}
				}
			}
		}
	}

	/* Special handling for Dropouts (download_pink): collapse month-wise rows into a single 'All months' row per Session Site */
	$__skip_highlight_loop = false;
	if(str_starts_with($key,'drop_') && $idxMonth !== null){
		$pairMap = isset($_SESSION['drop_pair_map']) ? $_SESSION['drop_pair_map'] : [];
		$from = null; $to = null;
		if(isset($pairMap[$key]) && is_array($pairMap[$key])){
			$from = isset($pairMap[$key]['from']) ? $pairMap[$key]['from'] : null;
			$to   = isset($pairMap[$key]['to'])   ? $pairMap[$key]['to']   : null;
		}

		// Try to locate Session Site column for extra highlighting (best-effort; keeps existing logic unchanged otherwise)
		$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);

		$groups = [];
		$order = [];
		$colCount = count($header);

		for($ri=1;$ri<count($full);$ri++){
			$r = $full[$ri];
			if(count($r)<$colCount) $r=array_pad($r,$colCount,'');

			// Group by all identifier cells before the Month column (Session Site level in UWIN exports)
			$idCells = array_slice($r, 0, $idxMonth);
			$gk = implode("\x1F", $idCells);

			if(!isset($groups[$gk])){
				$groups[$gk] = [
					'id'  => $idCells,
					'sum' => array_fill(0,$colCount,0.0),
					'has' => array_fill(0,$colCount,false)
				];
				$order[] = $gk;
			}

			for($ci=$idxMonth+1;$ci<$colCount;$ci++){
				$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
				if($raw==='') continue;

				// Sum numeric values; ignore non-numeric text
				$raw2 = str_replace([',',' '],['',''],$raw);
				if(is_numeric($raw2)){
					$groups[$gk]['sum'][$ci] += (float)$raw2;
					$groups[$gk]['has'][$ci] = true;
				}
			}
		}

		$fmt_sum = function($v){
			if(!is_finite($v)) return '';
			if(abs($v - round($v)) < 1e-9) return (string)intval(round($v));
			$s = rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
			return $s;
		};

		$collapsed = [];
		$collapsed[] = $header;
		$style_map = []; // replace style map with collapsed-row indices

		// Dropout % ranges currently selected (already expanded in session filters)
		$selDropRanges = isset($filters['drop_ranges']) ? array_fill_keys((array)$filters['drop_ranges'], true) : [];
		$dropMatch = function($pct) use ($selDropRanges){
			if(empty($selDropRanges)) return true; // safety: treat as "all"
			if(isset($selDropRanges['R5_10']) && $pct>=5 && $pct<=10.99) return true;
			if(isset($selDropRanges['R11_20']) && $pct>=11 && $pct<=19.99) return true;
			if(isset($selDropRanges['R20P']) && $pct>=20) return true;
			return false;
		};

		$colFrom = ($from!==null && isset($idxByShort[$from])) ? $idxByShort[$from] : null;
		$colTo   = ($to!==null   && isset($idxByShort[$to]))   ? $idxByShort[$to]   : null;

		$outRi = 1;
		foreach($order as $gk){
			$g = $groups[$gk];

			// Determine whether this Session Site is an actual dropout for the selected pair + selected Dropout % range(s)
			// NOTE: We still EXPORT ALL Session Sites (all data), but only HIGHLIGHT those that meet the dropout rule.
			$shouldHighlight = false;
			if($colFrom!==null && $colTo!==null && !empty($g['has'][$colFrom]) && !empty($g['has'][$colTo])){
				$A = (float)$g['sum'][$colFrom];
				$B = (float)$g['sum'][$colTo];
				// Dropout implies the second vaccine must be strictly lower than the first
				if($A>0 && $B < $A){
					$dropPct = ($A-$B)/$A*100;
					if($dropMatch($dropPct)) $shouldHighlight = true;
				}
			}

			$row = array_pad($g['id'], $colCount, '');
			$row[$idxMonth] = 'All months';

			for($ci=$idxMonth+1;$ci<$colCount;$ci++){
				$row[$ci] = $g['has'][$ci] ? $fmt_sum($g['sum'][$ci]) : '';
			}

			$collapsed[] = $row;

			// Highlight ONLY if this Session Site is an actual dropout as per the selected Dropout % option
			if($shouldHighlight){
				// Highlight the Dropout pair columns + Health Facility Name + Session Site Name
				if($idxFac!==null) $style_map[$outRi][$idxFac] = true;
				if($idxSessionSite!==null) $style_map[$outRi][$idxSessionSite] = true;
				if($colFrom!==null) $style_map[$outRi][$colFrom] = true;
				if($colTo!==null) $style_map[$outRi][$colTo] = true;
			}

			$outRi++;
		}

		// Replace output rows with collapsed version and skip the normal per-row highlight logic
		$full = $collapsed;
		$__skip_highlight_loop = true;
	}

	
	/* Special handling for Avg Beneficiaries per session < 5 (download_pink): apply the same rule as Dropouts
	   - Collapse month-wise rows into a single 'All months' row per Session Site (group by identifier cells before Month)
	   - Export ALL Session Sites (all data)
	   - Highlight ONLY those Session Sites where Avg Beneficiaries per session (PW+Inf+Child+Adol) / Sessions Held is < 5 on totals
	   - Also highlight Health Facility Name + Session Site Name cells + the contributing columns
	*/
	if($key==='t8' && $idxMonth !== null){
		$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);

		$groups = [];
		$order = [];
		$colCount = count($header);

		for($ri=1;$ri<count($full);$ri++){
			$r = $full[$ri];
			if(count($r)<$colCount) $r=array_pad($r,$colCount,'');

			// Group by all identifier cells before the Month column (Session Site level in UWIN exports)
			$idCells = array_slice($r, 0, $idxMonth);
			$gk = implode("\x1F", $idCells);

			if(!isset($groups[$gk])){
				$groups[$gk] = [
					'id'  => $idCells,
					'sum' => array_fill(0,$colCount,0.0),
					'has' => array_fill(0,$colCount,false)
				];
				$order[] = $gk;
			}

			for($ci=$idxMonth+1;$ci<$colCount;$ci++){
				$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
				if($raw==='') continue;

				// Sum numeric values; ignore non-numeric text
				$raw2 = str_replace([',',' '],['',''],$raw);
				if(is_numeric($raw2)){
					$groups[$gk]['sum'][$ci] += (float)$raw2;
					$groups[$gk]['has'][$ci] = true;
				}
			}
		}

		$fmt_sum = function($v){
			if(!is_finite($v)) return '';
			if(abs($v - round($v)) < 1e-9) return (string)intval(round($v));
			$s = rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
			return $s;
		};

		$collapsed = [];
		$collapsed[] = $header;

		$outRi = 1;
		foreach($order as $gk){
			$g = $groups[$gk];

			// Build the collapsed "All months" row
			$row = array_pad($g['id'], $colCount, '');
			$row[$idxMonth] = 'All months';

			for($ci=$idxMonth+1;$ci<$colCount;$ci++){
				$row[$ci] = $g['has'][$ci] ? $fmt_sum($g['sum'][$ci]) : '';
			}
			$collapsed[] = $row;

			// Decide whether to highlight this Session Site as per KPI rule (Avg Beneficiaries per session < 5)
			$shouldHighlight = false;
			if($iSessH!==null && $iBenPW!==null && $iBenInf!==null && $iBenChild!==null && $iBenAdol!==null){
				$H  = (float)$g['sum'][$iSessH];
				$PW = (float)$g['sum'][$iBenPW];
				$IN = (float)$g['sum'][$iBenInf];
				$CH = (float)$g['sum'][$iBenChild];
				$AD = (float)$g['sum'][$iBenAdol];
				$BEN = $PW + $IN + $CH + $AD;
				if($H > 0){
					$avg = $BEN / $H;
					if($avg < 5) $shouldHighlight = true;
				}
			}

			if($shouldHighlight){
				// Highlight Health Facility Name + Session Site Name + contributing columns
				if($idxFac!==null) $style_map[$outRi][$idxFac] = true;
				if($idxSessionSite!==null) $style_map[$outRi][$idxSessionSite] = true;
				if($iSessH!==null) $style_map[$outRi][$iSessH] = true;
				if($iBenPW!==null) $style_map[$outRi][$iBenPW] = true;
				if($iBenInf!==null) $style_map[$outRi][$iBenInf] = true;
				if($iBenChild!==null) $style_map[$outRi][$iBenChild] = true;
				if($iBenAdol!==null) $style_map[$outRi][$iBenAdol] = true;
			}

			$outRi++;
		}

		$full = $collapsed;
		$__skip_highlight_loop = true;
	}

/* Special handling for Consistency / Inconsistencies (download_pink): apply the same rule as Dropouts
	   - Collapse month-wise rows into a single 'All months' row per Session Site (group by identifier cells before Month)
	   - Export ALL Session Sites (all data)
	   - Highlight ONLY those Session Sites that violate the selected Inconsistency rule (e.g., Penta3>Penta1, OPV3>OPV1)
	*/
	if(!$__skip_highlight_loop && str_starts_with($key,'t5_') && $idxMonth !== null){
		// Resolve the inconsistency pair for the selected KPI key
		$from = null; $to = null;
		if($key === 't5_p3gtp1'){ $from = 'Penta3'; $to = 'Penta1'; }
		elseif($key === 't5_opv3gtopv1'){ $from = 'OPV3'; $to = 'OPV1'; }
		elseif(isset($incons_pair_map[$key]) && is_array($incons_pair_map[$key])){
			$from = isset($incons_pair_map[$key]['from']) ? $incons_pair_map[$key]['from'] : null;
			$to   = isset($incons_pair_map[$key]['to'])   ? $incons_pair_map[$key]['to']   : null;
		}

		// If we cannot resolve a pair, do not change export behavior
		if($from !== null && $to !== null){
			$colFrom = isset($idxByShort[$from]) ? $idxByShort[$from] : null;
			$colTo   = isset($idxByShort[$to])   ? $idxByShort[$to]   : null;

			// Need both target columns; otherwise keep original behavior
			if($colFrom !== null && $colTo !== null){
				// Try to locate Session Site column for extra highlighting
				$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);

				$groups = [];
				$order = [];
				$colCount = count($header);

				for($ri=1;$ri<count($full);$ri++){
					$r = $full[$ri];
					if(count($r)<$colCount) $r=array_pad($r,$colCount,'');

					// Group by all identifier cells before the Month column (Session Site level)
					$idCells = array_slice($r, 0, $idxMonth);
					$gk = implode("\x1F", $idCells);
					if(!isset($groups[$gk])){
						$groups[$gk] = [
							'id'  => $idCells,
							'sum' => array_fill(0,$colCount,0.0),
							'has' => array_fill(0,$colCount,false)
						];
						$order[] = $gk;
					}

					for($ci=$idxMonth+1;$ci<$colCount;$ci++){
						$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
						if($raw==='') continue;
						$raw2 = str_replace([',',' '],['',''],$raw);
						if(is_numeric($raw2)){
							$groups[$gk]['sum'][$ci] += (float)$raw2;
							$groups[$gk]['has'][$ci] = true;
						}
					}
				}

				$fmt_sum = function($v){
					if(!is_finite($v)) return '';
					if(abs($v - round($v)) < 1e-9) return (string)intval(round($v));
					$s = rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
					return $s;
				};

				$collapsed = [];
				$collapsed[] = $header;
				$style_map = []; // replace style map with collapsed-row indices

				$outRi = 1;
				foreach($order as $gk){
					$g = $groups[$gk];
					$row = array_pad($g['id'], $colCount, '');
					$row[$idxMonth] = 'All months';
					for($ci=$idxMonth+1;$ci<$colCount;$ci++){
						$row[$ci] = $g['has'][$ci] ? $fmt_sum($g['sum'][$ci]) : '';
					}
					$collapsed[] = $row;

					// Highlight ONLY if this Session Site violates the inconsistency rule on totals
					$shouldHighlight = false;
					if(!empty($g['has'][$colFrom]) && !empty($g['has'][$colTo])){
						$A = (float)$g['sum'][$colFrom];
						$B = (float)$g['sum'][$colTo];
						// Inconsistency implies later dose > earlier dose (strict)
						if($A > $B){
							$shouldHighlight = true;
						}
					}
					if($shouldHighlight){
						if($idxFac!==null) $style_map[$outRi][$idxFac] = true;
						if($idxSessionSite!==null) $style_map[$outRi][$idxSessionSite] = true;
						$style_map[$outRi][$colFrom] = true;
						$style_map[$outRi][$colTo] = true;
					}

					$outRi++;
				}

				$full = $collapsed;
				$__skip_highlight_loop = true;
			}
		}
	}

	
	
	/* Special handling for Consistency / Co-admin equality checks (download_pink): apply the same rule as Dropouts
	   - Collapse month-wise rows into a single 'All months' row per Session Site (group by identifier cells before Month)
	   - Export ALL Session Sites (all data)
	   - Highlight ONLY those Session Sites that violate the selected co-admin equality rule (any value differs within the group)
	   - Also highlight Health Facility Name and Session Site Name cells when a violation occurs
	   - Keep existing light/dark pink behavior: all group cells light pink; differing cells dark pink
	*/
	if(!$__skip_highlight_loop && $idxMonth !== null && in_array($key, ['co1','co2','co3','co4','co5'], true)){
		$coGroups = [
			'co1'=>['OPV1','Penta1','RVV1','PCV1','IPV1'],
			'co2'=>['OPV2','Penta2','RVV2'],
			'co3'=>['OPV3','Penta3','RVV3','PCV2','IPV2'],
			'co4'=>['MR1','PCV Booster','IPV3'],
			'co5'=>['MR2','DPT 1st Booster'],
		];

		$groupShorts = isset($coGroups[$key]) ? $coGroups[$key] : [];
		$groupCols = [];
		foreach($groupShorts as $sh){
			if(isset($idxByShort[$sh])) $groupCols[$sh] = $idxByShort[$sh];
		}

		// If we cannot resolve at least 2 group columns, keep original behavior
		if(count($groupCols) >= 2){
			$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);

			$groups = [];
			$order = [];
			$colCount = count($header);

			for($ri=1;$ri<count($full);$ri++){
				$r = $full[$ri];
				if(count($r)<$colCount) $r=array_pad($r,$colCount,'');

				// Group by all identifier cells before the Month column (Session Site level)
				$idCells = array_slice($r, 0, $idxMonth);
				$gk = implode("\x1F", $idCells);
				if(!isset($groups[$gk])){
					$groups[$gk] = [
						'id'  => $idCells,
						'sum' => array_fill(0,$colCount,0.0),
						'has' => array_fill(0,$colCount,false)
					];
					$order[] = $gk;
				}

				// Sum numeric indicator columns (after Month)
				for($ci=$idxMonth+1;$ci<$colCount;$ci++){
					$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
					if($raw==='') continue;
					$raw2 = str_replace([',',' '],['',''],$raw);
					if(is_numeric($raw2)){
						$groups[$gk]['sum'][$ci] += (float)$raw2;
						$groups[$gk]['has'][$ci] = true;
					}
				}
			}

			$fmt_sum = function($v){
				if(!is_finite($v)) return '';
				if(abs($v - round($v)) < 1e-9) return (string)intval(round($v));
				$s = rtrim(rtrim(sprintf('%.6F', $v), '0'), '.');
				return $s;
			};

			$collapsed = [];
			$collapsed[] = $header;
			$style_map = []; // replace style map with collapsed-row indices

			$outRi = 1;
			foreach($order as $gk){
				$g = $groups[$gk];
				$row = array_pad($g['id'], $colCount, '');
				$row[$idxMonth] = 'All months';
				for($ci=$idxMonth+1;$ci<$colCount;$ci++){
					$row[$ci] = $g['has'][$ci] ? $fmt_sum($g['sum'][$ci]) : '';
				}
				$collapsed[] = $row;

				// Determine if this Session Site violates equality rule on totals
				$vals = [];
				foreach($groupCols as $sh=>$ci){
					if(!empty($g['has'][$ci])){
						$vals[$sh] = (float)$g['sum'][$ci];
					}
				}

				$shouldHighlight = false;
				if(count($vals) >= 2){
					$minv = min($vals);
					$maxv = max($vals);
					if($maxv != $minv){
						$shouldHighlight = true;
					}
				}

				if($shouldHighlight){
					// Highlight Facility and Session Site cells
					if($idxFac!==null) $style_map[$outRi][$idxFac] = true;
					if($idxSessionSite!==null) $style_map[$outRi][$idxSessionSite] = true;

					// Light pink for all group cells; dark pink for cells differing from the majority value
					$counts = [];
					foreach($vals as $sh=>$v){
						$k = (string)$v;
						if(!isset($counts[$k])) $counts[$k]=0;
						$counts[$k]++;
					}
					$maxCount = 0;
					foreach($counts as $ct){ if($ct > $maxCount) $maxCount = $ct; }
					$allUnique = ($maxCount <= 1);
foreach($groupCols as $sh=>$ci){
						// Always light pink for group columns (even if blank/missing)
						$style_map[$outRi][$ci] = true;
					}
					// Darker pink + bold only for cells whose value is unique within the group;
					// if all values are unique (no two cells match), mark all as differing.
					foreach($vals as $sh=>$v){
						$ci = $groupCols[$sh];
						$vk = (string)$v;
						if($allUnique || (isset($counts[$vk]) && $counts[$vk] === 1)){
							$style_map[$outRi][$ci] = ['color'=>$DARK_PINK,'bold'=>true];
						}
					}
}

				$outRi++;
			}

			$full = $collapsed;
			$__skip_highlight_loop = true;
		}
	}

/* Special handling for Outliers (download_pink): compute hits per Session Site (instead of facility) for highlighting */
	$outlier_hits_ss = null;
	if($key === 't3' && $idxMonth !== null && $idxSessionSite !== null){
		// Selected vaccines (same logic used elsewhere in the tool)
		$selV = isset($filters['outliers_vax']) && is_array($filters['outliers_vax']) ? $filters['outliers_vax'] : [];
		$selA = isset($filters['add_vax']) && is_array($filters['add_vax']) ? $filters['add_vax'] : [];
		$selVaxList = array_values(array_unique(array_merge($selV,$selA)));
		if(empty($selVaxList)){
			$selVaxList = ['BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2'];
		}
		$tmp = [];
		foreach($selVaxList as $vx){ if(isset($idxByShort[$vx])) $tmp[] = $vx; }
		$selVaxList = !empty($tmp) ? $tmp : array_keys($idxByShort);
	
		// Selected months ordered (use selected months; if none, use all months)
		$selMonthKeysOrdered = !empty($selMonths) ? array_keys($selMonths) : array_keys($allMonths);
		sort($selMonthKeysOrdered, SORT_STRING);
	
		// Consecutive month-pairs (same definition as Outliers table)
		$pairList = [];
		for($i=0;$i<count($selMonthKeysOrdered)-1;$i++){
			$m1 = $selMonthKeysOrdered[$i];
			$m2 = $selMonthKeysOrdered[$i+1];
			$pairList[] = ['m1'=>$m1,'m2'=>$m2];
		}
	
		// Bucket selection (same as Outliers)
		$incBucketsSel = array_fill_keys((array)(isset($filters['outliers_inc']) ? $filters['outliers_inc'] : []), true);
		$dropBucketsSel= array_fill_keys((array)(isset($filters['outliers_drop']) ? $filters['outliers_drop'] : []), true);
		$bucketHit = function($p) use ($incBucketsSel,$dropBucketsSel){
			if($p>0){
				if(isset($incBucketsSel['INC_LOW']) && $p>=25 && $p<=50.49) return true;
				if(isset($incBucketsSel['INC_MOD']) && $p>=50.50 && $p<=100) return true;
				if(isset($incBucketsSel['INC_EXT']) && $p>100) return true;
			}
			elseif($p<0){
				if(isset($dropBucketsSel['DROP_LOW']) && $p<=-25 && $p>=-50.49) return true;
				if(isset($dropBucketsSel['DROP_MOD']) && $p<=-50.50 && $p>=-100) return true;
				if(isset($dropBucketsSel['DROP_EXT']) && $p<-100) return true;
			}
			return false;
		};
	
		// Build per Session Site values map: rkss => monthKey => short => value
		$vals = [];
		$colCount = count($header);
		for($ri=1;$ri<count($full);$ri++){
			$r = $full[$ri];
			if(count($r)<$colCount) $r = array_pad($r,$colCount,'');
	
			$block = ($idxBlock!==null && isset($r[$idxBlock])) ? trim((string)$r[$idxBlock]) : '';
			$fac   = ($idxFac!==null && isset($r[$idxFac])) ? trim((string)$r[$idxFac]) : '';
			$sess  = isset($r[$idxSessionSite]) ? trim((string)$r[$idxSessionSite]) : '';
			$monRaw= isset($r[$idxMonth]) ? (string)$r[$idxMonth] : '';
			$mKey  = month_key($monRaw);
	
			if($sess==='') continue;
	
			// Respect facility set for this KPI (keeps behavior consistent with KPI selection; sets are session-site-wise)
			$rowKeyFac = $block.'||'.$fac.'||'.$sess;
			if(!empty($facSet) && !isset($facSet[$rowKeyFac])) continue;
	
			// Respect selected months
			if(!empty($selMonths)){
				if($mKey===null || !isset($selMonths[$mKey])) continue;
			}
	
			$rkss = $block.'||'.$fac.'||'.$sess;
			foreach($selVaxList as $vx){
				if(!isset($idxByShort[$vx])) continue;
				$ci = $idxByShort[$vx];
				$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
				if($raw==='') continue;
				$raw2 = str_replace([',',' '],['',''],$raw);
				if(!is_numeric($raw2)) continue;
				$vals[$rkss][$mKey][$vx] = (float)$raw2;
			}
		}
	
		// Compute hits per Session Site
		$outlier_hits_ss = [];
		if(!empty($pairList)){
			foreach($vals as $rkss=>$mmap){
				foreach($selVaxList as $vx){
					foreach($pairList as $p){
						$m1 = $p['m1']; $m2 = $p['m2'];
						$v1 = (isset($mmap[$m1]) && isset($mmap[$m1][$vx])) ? $mmap[$m1][$vx] : null;
						$v2 = (isset($mmap[$m2]) && isset($mmap[$m2][$vx])) ? $mmap[$m2][$vx] : null;
						$pc = pct_change($v1,$v2);
						if($pc===null) continue;
						$pctVal = $pc*100;
						if($bucketHit($pctVal)){
							$outlier_hits_ss[$rkss][$m1][$vx] = true;
							$outlier_hits_ss[$rkss][$m2][$vx] = true;
						}
					}
				}
			}
		}
	}
	
	if(!$__skip_highlight_loop){
	for($ri=1;$ri<count($full);$ri++){

		$r = $full[$ri];
		$block = ($idxBlock!==null && isset($r[$idxBlock])) ? trim((string)$r[$idxBlock]) : '';
		$fac = ($idxFac!==null && isset($r[$idxFac])) ? trim((string)$r[$idxFac]) : '';
		$sess = ($idxSessionSite!==null && isset($r[$idxSessionSite])) ? trim((string)$r[$idxSessionSite]) : '';
		$monRaw= ($idxMonth!==null && isset($r[$idxMonth])) ? (string)$r[$idxMonth] : '';
		$mKey = ($idxMonth!==null) ? month_key($monRaw) : null;
		$rowKey = $block.'||'.$fac.'||'.$sess;

		$monthOk = true;
		if(!empty($selMonths) && $mKey!==null){
			$monthOk = isset($selMonths[$mKey]);
		}
		$rowInSet = !empty($facSet) ? isset($facSet[$rowKey]) : false;
		if(!$rowInSet || !$monthOk) continue;

		/* Availability: highlight FULL ROW using the same facility-month aggregation as the KPI/table */
		if($key === 't0'){
			if($idxMonth===null || $mKey===null) continue;
			if(isset($availability_raw_zero_rows[$ri])){
				for($ci=0;$ci<count($header);$ci++){ $style_map[$ri][$ci]=true; }
			}
		}
		elseif($key === 't7'){
			if($idxMonth===null || $mKey===null) continue;
			if(isset($availability_group_hits['t7'][$rowKey]) && isset($availability_group_hits['t7'][$rowKey][$mKey])){
				for($ci=0;$ci<count($header);$ci++){ $style_map[$ri][$ci]=true; }
			}
		}
		/* NEW: Total Beneficiaries vaccinated = 0 (highlight beneficiary columns + facility + session site) */
		elseif($key === 't9'){
			if($idxMonth===null || $mKey===null) continue;
			if(isset($availability_group_hits['t9'][$rowKey]) && isset($availability_group_hits['t9'][$rowKey][$mKey])){
				if($idxFac!==null) $style_map[$ri][$idxFac] = true;
				if($idxSessionSite!==null) $style_map[$ri][$idxSessionSite] = true;
				foreach($benZeroIdxList as $bi){ $style_map[$ri][$bi] = true; }
			}
		}
		elseif($key === 't2'){
			$selV = isset($filters['outliers_vax']) && is_array($filters['outliers_vax']) ? $filters['outliers_vax'] : [];
			$selA = isset($filters['add_vax']) && is_array($filters['add_vax']) ? $filters['add_vax'] : [];
			$sel = [];
			foreach(array_merge($selV,$selA) as $vx){ $sel[$vx]=true; }
			if(empty($sel)){
				$sel = ['BCG'=>true,'Penta1'=>true,'Penta3'=>true,'OPV1'=>true,'OPV3'=>true,'MR1'=>true,'MR2'=>true];
			}
			foreach($indicatorIdxTargets as $ci=>$meta){
				if(!isset($sel[$meta['short']])) continue;
				$raw = trim((string)(isset($r[$ci]) ? $r[$ci] : ''));
				if($raw === ''){ $style_map[$ri][$ci]=true; }
			}
		}
		elseif($key === 't3'){
			if($mKey===null) continue;

			// Prefer Session Site–level outlier highlighting when possible
			if(is_array($outlier_hits_ss) && $idxSessionSite!==null){
				$sess = (isset($r[$idxSessionSite])) ? trim((string)$r[$idxSessionSite]) : '';
				if($sess==='') continue;
				$rkss = $rowKey.'||'.$sess;
				if(!isset($outlier_hits_ss[$rkss]) || !isset($outlier_hits_ss[$rkss][$mKey])) continue;
				$rowHits = $outlier_hits_ss[$rkss][$mKey];
				$hitAny = false;
				foreach($rowHits as $short=>$on){
					if(!$on) continue;
					$hitAny = true;
					if(isset($idxByShort[$short])){ $style_map[$ri][$idxByShort[$short]] = true; }
				}
				if($hitAny){
					if($idxFac!==null) $style_map[$ri][$idxFac] = true;
					$style_map[$ri][$idxSessionSite] = true;
				}
			} else {
				// Fallback to facility-level hit map (keeps previous behavior if Session Site column isn't available)
				if(!isset($outlier_hits[$rowKey]) || !isset($outlier_hits[$rowKey][$mKey])) continue;
				$rowHits = $outlier_hits[$rowKey][$mKey];
				$hitAny = false;
				foreach($rowHits as $short=>$on){
					if(!$on) continue;
					$hitAny = true;
					if(isset($idxByShort[$short])){ $style_map[$ri][$idxByShort[$short]] = true; }
				}
				if($hitAny){
					if($idxFac!==null) $style_map[$ri][$idxFac] = true;
					if($idxSessionSite!==null && isset($r[$idxSessionSite])) $style_map[$ri][$idxSessionSite] = true;
				}
			}
		}
		elseif(str_starts_with($key,'drop_')){
			if($mKey===null) continue;
			if(!isset($drop_hits[$key]) || !isset($drop_hits[$key][$rowKey])) continue;
			if(!isset($drop_hits[$key][$rowKey][$mKey]) || !$drop_hits[$key][$rowKey][$mKey]) continue;
			$pairMap = isset($_SESSION['drop_pair_map']) ? $_SESSION['drop_pair_map'] : [];
			if(!isset($pairMap[$key])) continue;
			$from = $pairMap[$key]['from'];
			$to = $pairMap[$key]['to'];
			if(isset($idxByShort[$from])) $style_map[$ri][$idxByShort[$from]] = true;
			if(isset($idxByShort[$to])) $style_map[$ri][$idxByShort[$to]] = true;
		}
		elseif($key === 't6'){
			if($iSessP!==null && $iSessH!==null){
				$Praw = trim((string)(isset($r[$iSessP]) ? $r[$iSessP] : ''));
				$Hraw = trim((string)(isset($r[$iSessH]) ? $r[$iSessH] : ''));
				if($Praw!=='' && $Hraw!=='' && is_numeric($Praw) && is_numeric($Hraw)){
					$P=0+$Praw; $H=0+$Hraw;
					/* CHANGED: "Planned but not held" => Sessions Held < Sessions Planned */
					if($P>0 && $H<$P){
						$style_map[$ri][$iSessP]=true;
						$style_map[$ri][$iSessH]=true;
					}
				}
			}
		}
		elseif($key === 't8'){
			if($iSessH!==null && $iBenPW!==null && $iBenInf!==null && $iBenChild!==null && $iBenAdol!==null){
				$Hraw = trim((string)(isset($r[$iSessH]) ? $r[$iSessH] : ''));
				$pwRaw = trim((string)(isset($r[$iBenPW]) ? $r[$iBenPW] : ''));
				$infRaw = trim((string)(isset($r[$iBenInf]) ? $r[$iBenInf] : ''));
				$chRaw = trim((string)(isset($r[$iBenChild]) ? $r[$iBenChild] : ''));
				$adRaw = trim((string)(isset($r[$iBenAdol]) ? $r[$iBenAdol] : ''));
				if($Hraw!=='' && is_numeric($Hraw)){
					$H = 0+$Hraw;
					if($H>0){
						$hasBen=false; $ben=0;
						foreach([$pwRaw,$infRaw,$chRaw,$adRaw] as $bv){
							if($bv!=='' && is_numeric($bv)){ $ben += (0+$bv); $hasBen=true; }
						}
						if($hasBen){
							$avg = $ben / $H;
							if($avg < 5){
								$style_map[$ri][$iSessH]=true;
								$style_map[$ri][$iBenPW]=true;
								$style_map[$ri][$iBenInf]=true;
								$style_map[$ri][$iBenChild]=true;
								$style_map[$ri][$iBenAdol]=true;
							}
						}
					}
				}
			}
		}
		elseif(str_starts_with($key,'co')){
			$group = $key;
			$groupShorts = [];
			if($group==='co1'){ $groupShorts = ['OPV1','Penta1','RVV1','PCV1','IPV1']; }
			elseif($group==='co2'){ $groupShorts = ['OPV2','Penta2','RVV2']; }
			elseif($group==='co3'){ $groupShorts = ['OPV3','Penta3','RVV3','PCV2','IPV2']; }
			elseif($group==='co4'){ $groupShorts = ['MR1','PCV Booster','IPV3']; }
			else { $groupShorts = ['MR2','DPT 1st Booster']; }
			$groupIdxs = [];
			foreach($groupShorts as $s){ if(isset($idxByShort[$s])) $groupIdxs[] = $idxByShort[$s]; }
			if(empty($groupIdxs)) continue;

			// Light-pink all group cells, and then dark-pink+bold ONLY the cell(s) whose value differs from the others.
			$norm = [];
			$counts = [];
			foreach($groupIdxs as $ci){
				$style_map[$ri][$ci] = true; // light pink for the full group
				$raw = isset($r[$ci]) ? trim((string)$r[$ci]) : '';
				if($raw==='' ){
					$k = '';
				}else{
					if(is_numeric($raw)){
						$v = 0 + $raw;
						$k = sprintf('%.10F', $v);
					}else{
						$k = strtolower($raw);
					}
				}
				$norm[$ci] = $k;
				$counts[$k] = isset($counts[$k]) ? $counts[$k] + 1 : 1;
			}

			// If not all equal, mark the differing cell(s) darker + bold.
			if(count($counts) > 1){
				$modeK = null; $modeC = -1;
				foreach($counts as $k=>$c){
					if($c > $modeC){ $modeC = $c; $modeK = $k; }
				}
				foreach($norm as $ci=>$k){
					if($k !== $modeK){
						$style_map[$ri][$ci] = ['color'=>$DARK_PINK,'bold'=>true];
					}
				}
			}
		}
		elseif($key === 't5_p3gtp1' || $key === 't5_opv3gtopv1'){
			$shortA = ($key==='t5_p3gtp1') ? 'Penta3' : 'OPV3';
			$shortB = ($key==='t5_p3gtp1') ? 'Penta1' : 'OPV1';
			if(isset($idxByShort[$shortA])) $style_map[$ri][$idxByShort[$shortA]] = true;
			if(isset($idxByShort[$shortB])) $style_map[$ri][$idxByShort[$shortB]] = true;
		}
		/* NEW: dynamic inconsistencies highlight (both vaccines) */
		elseif(str_starts_with($key,'t5_') && isset($incons_pair_map[$key])){
			$from = $incons_pair_map[$key]['from'];
			$to = $incons_pair_map[$key]['to'];
			if(isset($idxByShort[$to])) $style_map[$ri][$idxByShort[$to]] = true;
			if(isset($idxByShort[$from])) $style_map[$ri][$idxByShort[$from]] = true;
		}
	}

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

if($action==='upload' && isset($_FILES['csv_files'])){
	/* Multi-file (month-wise) upload: up to 12 files. If Month column is not present in a file,
	   the user-provided month (or filename-inferred month) is injected into a synthetic Month column.
	   Output/analytics remain exactly the same as the single-file version. */
	$f = $_FILES['csv_files'];

	// Normalize the multi-upload array
	$fileCount = is_array($f['name']) ? count($f['name']) : 0;
	$files = [];
	for($i=0;$i<$fileCount;$i++){
		if(!isset($f['error'][$i])) continue;
		if($f['error'][$i]===UPLOAD_ERR_NO_FILE) continue;
		$files[] = [
			'name' => $f['name'][$i],
			'tmp_name' => $f['tmp_name'][$i],
			'error' => $f['error'][$i],
		];
	}

	if(empty($files)){
		render_page("Please select at least one CSV file.");
		exit;
	}
	if(count($files) > 12){
		render_page("Please upload a maximum of 12 month-wise CSV files.");
		exit;
	}

	// Month values from the UI (same order as files[])
	$postMonths = isset($_POST['file_month']) ? (array)$_POST['file_month'] : [];
	while(count($postMonths) < count($files)) $postMonths[] = '';

	$parse_month_from_filename = function($fname){
		$base = strtolower(basename((string)$fname));
		// yyyy-mm / yyyy_mm / yyyy mm
		if(preg_match('/\b(20\d{2})\D?(0?[1-9]|1[0-2])\b/', $base, $m)){
			$y = $m[1];
			$mm = str_pad((string)(int)$m[2], 2, '0', STR_PAD_LEFT);
			return $y.'-'.$mm;
		}
		// mon + year (jan..dec) + (yy|yyyy)
		if(preg_match('/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\D?(20\d{2}|\d{2})\b/', $base, $m)){
			$mon = substr($m[1],0,3);
			$yy = $m[2];
			$year = (strlen($yy)===2) ? ('20'.$yy) : $yy;
			// Return a Month-Year string that month_key() parses reliably
			return ucfirst($mon).'-'.substr($year,-2);
		}
		return '';
	};

	$canonicalHeader = null;
	$canonicalNorm = null;
	$canonicalMap = [];
	$mergedRows = [];

	$firstOrigName = $files[0]['name'];
	$allOrigNames = [];

	// For detecting required columns in each file
	$requiredBlockNames = ['lgd block name','lgd_block_name','lgd block','lgdblockname','block name','health block name','block','block_name'];
	$requiredFacNames = ['health facility name','health_facility_name','facility name','facility_name'];
	$monthNames         = ['month','reporting month','month name'];
	$requiredUlbNames = ['lgd ulb name','lgd_ulb_name'];

	foreach($files as $i=>$file){
		$allOrigNames[] = $file['name'];

		if($file['error']!==UPLOAD_ERR_OK){
			render_page("Upload failed for ".h($file['name']).": error code ".$file['error']);
			exit;
		}
		$csvPath = $file['tmp_name'];
		$fh = fopen($csvPath,'r');
		if(!$fh){
			render_page("Cannot open uploaded file: ".h($file['name']));
			exit;
		}

		
$rawHeader = fgetcsv($fh);
if(!$rawHeader){
    fclose($fh);
    render_page("Empty file or unreadable header: ".h($file['name']));
    exit;
}

// Some UWIN downloads (especially after Excel conversion) may produce a 2-row header:
// 1st row = long labels, 2nd row = short codes (BCG/OPV1/Penta1/etc).
$secondRow = fgetcsv($fh);

$header = [];
$bufferFirstDataRow = null;

if($secondRow && is_probably_second_header_row($rawHeader, $secondRow)){
    $header = merge_two_header_rows($rawHeader, $secondRow);
} else {
    foreach($rawHeader as $hcell){ $header[] = strip_bom(trim((string)$hcell)); }
    // If $secondRow is actually data, keep it as the first data row
    $bufferFirstDataRow = $secondRow;
}
$norm = [];
		foreach($header as $hcell){ $norm[] = normalize_header($hcell); }

		$fileIdxBlock = find_block_col_index($header);
		$fileIdxFac   = find_facility_col_index($header);
		$fileIdxMonth = find_month_col_index($header);

		if($fileIdxBlock===null || $fileIdxFac===null){
			fclose($fh);
			render_page("Please upload CSV with required headers: LGD Block Name and Health Facility Name. Missing in: ".h($file['name']));
			exit;
		}

		// Determine month for this file if Month column is absent
		$fileMonthRaw = '';
		if($fileIdxMonth===null){
			$fileMonthRaw = trim((string)$postMonths[$i]);
			if($fileMonthRaw==='') $fileMonthRaw = $parse_month_from_filename($file['name']);
			if($fileMonthRaw===''){
				fclose($fh);
				render_page("Month column not found in ".h($file['name']).". Please enter the month for this file (e.g., 2025-04 or Apr-25).");
				exit;
			}
		}

		// Build canonical header from first file
		if($canonicalHeader===null){
			$canonicalHeader = $header;
			$canonicalNorm = $norm;

			// If Month is missing, insert synthetic Month column right after LGD ULB Name (UWIN format)
			// Fallback: insert after Facility if LGD ULB Name is not present.
			if($fileIdxMonth===null){
				$fileIdxLgdUlb = array_search_first($norm,$requiredUlbNames);
				$after = ($fileIdxLgdUlb!==null) ? $fileIdxLgdUlb : $fileIdxFac;
				$insPos = $after + 1;
				array_splice($canonicalHeader, $insPos, 0, ['Month']);
				array_splice($canonicalNorm, $insPos, 0, [normalize_header('Month')]);
			}

			// Build map norm->idx for canonical (first match only)
			foreach($canonicalNorm as $ci=>$hn){
				if(!isset($canonicalMap[$hn])) $canonicalMap[$hn] = $ci;
			}
		} else {
			// Validate that this file matches canonical header (ignoring Month differences)
			$canonNoMonth = [];
			foreach($canonicalNorm as $hn){
				if(in_array($hn,$monthNames,true)) continue;
				$canonNoMonth[] = $hn;
			}
			$fileNoMonth = [];
			foreach($norm as $hn){
				if(in_array($hn,$monthNames,true)) continue;
				$fileNoMonth[] = $hn;
			}
			if($canonNoMonth !== $fileNoMonth){
				fclose($fh);
				render_page("Header mismatch detected in ".h($file['name']).". Please ensure all month-wise files have the same columns (except Month).");
				exit;
			}
		}

		// Build per-file map norm->idx
		$fileMap = [];
		foreach($norm as $fi=>$hn){
			if(!isset($fileMap[$hn])) $fileMap[$hn] = $fi;
		}

		// Ensure we know canonical indices for required fields
		$idxBlock = find_block_col_index($canonicalHeader);
		$idxFac   = find_facility_col_index($canonicalHeader);
		$idxMonth = find_month_col_index($canonicalHeader);
		if($idxMonth===null){
			// In case Month was appended, it will normalize to 'month'
			$idxMonth = array_search_first($canonicalNorm,['month']);
		}

		// Read rows and map into canonical shape
		while(true){
			if(isset($bufferFirstDataRow) && $bufferFirstDataRow!==null){
				$r = $bufferFirstDataRow;
				$bufferFirstDataRow = null;
			} else {
				$r = fgetcsv($fh);
				if($r===false) break;
			}

			if(count($r)<count($header)) $r=array_pad($r,count($header),'');
			$out = array_fill(0, count($canonicalHeader), '');

			// Block & Facility
			$out[$idxBlock] = isset($r[$fileIdxBlock]) ? $r[$fileIdxBlock] : '';
			$out[$idxFac]   = isset($r[$fileIdxFac]) ? $r[$fileIdxFac] : '';

			// Month
			if($fileIdxMonth!==null){
				$out[$idxMonth] = isset($r[$fileIdxMonth]) ? $r[$fileIdxMonth] : '';
			} else {
				$out[$idxMonth] = $fileMonthRaw;
			}

			// Copy all other canonical columns by header name
			foreach($canonicalMap as $hn=>$ci){
				if($ci===$idxBlock || $ci===$idxFac || $ci===$idxMonth) continue;
				if(isset($fileMap[$hn])){
					$fi = $fileMap[$hn];
					$valTmp = isset($r[$fi]) ? $r[$fi] : '';
					$out[$ci] = ($idxMonth!==null && $ci>$idxMonth) ? sanitize_number($valTmp) : $valTmp;
}
			}

			$mergedRows[] = $out;
		}
		fclose($fh);
	}

	// Detect indices on canonical header
	$idxBlock = find_block_col_index($canonicalHeader);
	$idxFac   = find_facility_col_index($canonicalHeader);
	$idxMonth = find_month_col_index($canonicalHeader);
	$idxOwner = array_search_first($canonicalNorm,['ownership','ownership status']);
	$idxRU    = array_search_first($canonicalNorm,['rural/urban','rural urban','rural-urban','rural - urban','ruralurban','rural','urban']);
	$idxState = array_search_first($canonicalNorm,['state','state name','state_name']);
	$idxDist  = array_search_first($canonicalNorm,['district','district name','district_name']);

	if($idxBlock===null || $idxFac===null || $idxMonth===null){
		render_page("Please upload CSV with required headers: LGD Block Name, Health Facility Name, Month (or provide month per file).");
		exit;
	}

	/* NEW: Sort merged rows for consistent (sorted) downloads when multiple months are uploaded (applied safely for all uploads) */
	$idxSubDist = array_search_first($canonicalNorm, ['sub district','subdistrict','sub-district','sub district name','subdistrict name','subdistrict_name','sub_district','sub_district_name']);
	$idxSubCentre = array_search_first($canonicalNorm, ['sub centre name','subcenter name','sub centre','subcenter','sub-centre name','subcentre_name','sub_centre_name','sub centre_name','sub center name']);
	$idxType = array_search_first($canonicalNorm, ['type','facility type','session type']);
	$idxSessionSite = array_search_first($canonicalNorm, ['session site name','session site','session_site_name']);

	if(!empty($mergedRows) && count($mergedRows) > 1){
		$wrapped = [];
		foreach($mergedRows as $ri=>$rr){ $wrapped[] = ['i'=>$ri,'r'=>$rr]; }

		$cmpText = function($a,$b){
			$a = trim((string)$a); $b = trim((string)$b);
			if(function_exists('mb_strtolower')){ $a = mb_strtolower($a); $b = mb_strtolower($b); } else { $a = strtolower($a); $b = strtolower($b); }
			return $a <=> $b;
		};

		usort($wrapped, function($A,$B) use ($idxState,$idxDist,$idxBlock,$idxSubDist,$idxFac,$idxSubCentre,$idxType,$idxSessionSite,$idxMonth,$cmpText){
			$ra = $A['r']; $rb = $B['r'];

			$get = function($row,$idx){ return ($idx!==null && isset($row[$idx])) ? $row[$idx] : ''; };

			// Text keys
			$keys = [
				['idx'=>$idxState,'isMonth'=>false],
				['idx'=>$idxDist,'isMonth'=>false],
				['idx'=>$idxBlock,'isMonth'=>false],
				['idx'=>$idxSubDist,'isMonth'=>false],
				['idx'=>$idxFac,'isMonth'=>false],
				['idx'=>$idxSubCentre,'isMonth'=>false],
				['idx'=>$idxType,'isMonth'=>false],
				['idx'=>$idxSessionSite,'isMonth'=>false],
				['idx'=>$idxMonth,'isMonth'=>true],
			];

			foreach($keys as $k){
				$idx = $k['idx'];
				if($idx===null) continue;
				$av = $get($ra,$idx);
				$bv = $get($rb,$idx);
				if($k['isMonth']){
					$am = month_key($av);
					$bm = month_key($bv);
					$am = ($am===null) ? trim((string)$av) : $am;
					$bm = ($bm===null) ? trim((string)$bv) : $bm;
					$c = $cmpText($am,$bm);
				} else {
					$c = $cmpText($av,$bv);
				}
				if($c!==0) return $c;
			}

			// Stable tie-breaker
			return $A['i'] <=> $B['i'];
		});

		$mergedRows = [];
		foreach($wrapped as $w){ $mergedRows[] = $w['r']; }
	}

	if($STORE_TO_DB){
		$db = db_connect($GLOBALS['DB_HOST'],$GLOBALS['DB_USER'],$GLOBALS['DB_PASS'],$GLOBALS['DB_NAME']);
		db_bootstrap($db);
		if($db){
			$stmt=$db->prepare("INSERT INTO csv_uploads(filename,num_rows,header_json) VALUES(?,?,?)");
			if($stmt){
				$num_rows=count($mergedRows);
				$hjson=json_encode($canonicalHeader,JSON_UNESCAPED_UNICODE);
				$origName = 'merged: '.implode(', ', $allOrigNames);
				$stmt->bind_param('sis',$origName,$num_rows,$hjson);
				$stmt->execute();
				$stmt->close();
			}
			$db->close();
		}
	}

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
	$_SESSION['file_name']='merged_upload.csv';
	$_SESSION['file_names']=$allOrigNames;

	/* Default filters */
	$_SESSION['filters'] = [
		'blocks'=>[],
		'months'=>[],
		'ownership'=>[],
		'ru'=>[],
		'outliers_vax'=>['BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2'],
		'add_vax'=>[],
		'outliers_inc'=>['INC_EXT'],
		'outliers_drop'=>['DROP_EXT'],
		/* default ONLY >=20% */
		'drop_ranges'=>['R20P'],
		'drop_pairs'=>['Penta1→Penta3','MR1→MR2','BCG→MR1','Penta3→MR1'],
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
							<label>Select month-wise CSV file(s) (max 12). Use ctrl key to select multiple files.</ctrl></label>
							<input type="file" id="csv_files" name="csv_files[]" accept=".csv" multiple required>
							<div id="monthMap" style="margin-top:10px"></div>
							<div style="color:#475569;font-size:13px;margin-top:8px">
								If your files do not contain a <b>Month</b> column, enter the month for each file below (e.g., <b>2025-04</b> or <b>Apr-25</b>).
							</div>
							<script>
							(function(){
								var inp = document.getElementById('csv_files');
								var map = document.getElementById('monthMap');
								if(!inp || !map) return;
								function guessMonth(name){
									var n = (name||'').toLowerCase();
									var m = n.match(/\b(20\d{2})\D?(0?[1-9]|1[0-2])\b/);
									if(m){
										var y = m[1];
										var mm = ('0' + parseInt(m[2],10)).slice(-2);
										return y + '-' + mm;
									}
									m = n.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\D?(20\d{2}|\d{2})\b/);
									if(m){
										var mon = (m[1]||'').slice(0,3);
										var y2 = m[2]||'';
										if(y2.length===2) y2 = '20'+y2;
										mon = mon.charAt(0).toUpperCase() + mon.slice(1);
										return mon + '-' + y2.slice(-2);
									}
									return '';
								}
								function rebuild(){
									map.innerHTML = '';
									var files = inp.files;
									if(!files || !files.length) return;
									if(files.length > 12){
										alert('Please select up to 12 month-wise files.');
										inp.value = '';
										return;
									}
									var table = document.createElement('table');
									table.style.width = '100%';
									table.style.borderCollapse = 'collapse';
									table.innerHTML = '<thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">File</th><th style="text-align:left;padding:6px 8px;border-bottom:1px solid #e2e8f0">Month for this file (only if Month column missing)</th></tr></thead>';
									var tb = document.createElement('tbody');
									for(var i=0;i<files.length;i++){
										var tr = document.createElement('tr');
										var td1 = document.createElement('td');
										td1.style.padding = '6px 8px';
										td1.style.borderBottom = '1px solid #f1f5f9';
										td1.textContent = files[i].name;
										var td2 = document.createElement('td');
										td2.style.padding = '6px 8px';
										td2.style.borderBottom = '1px solid #f1f5f9';
										var input = document.createElement('input');
										input.type = 'text';
										input.name = 'file_month[]';
										input.placeholder = 'e.g., 2025-04 or Apr-25';
										input.value = guessMonth(files[i].name);
										input.style.width = '100%';
										input.style.padding = '10px 12px';
										input.style.border = '1px solid #e2e8f0';
										input.style.borderRadius = '10px';
										td2.appendChild(input);
										tr.appendChild(td1);
										tr.appendChild(td2);
										tb.appendChild(tr);
									}
									table.appendChild(tb);
									map.appendChild(table);
								}
								inp.addEventListener('change', rebuild);
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
</div>
						<div class="kpi kpiAcc"><h3>Accuracy</h3><div class="muted">Identification of logical errors and outliers in immunization data of UWIN portal</div></div>
						<div class="kpi kpiCons"><h3>Consistency</h3><div class="muted">Identification of discrepencies as per immunization logics</div></div>
					</div>
				</form>

				<?php if($msg): ?><div class="msg"><?=h($msg)?></div><?php endif; ?>
				<div class="footer">Your file is processed temporarily and is not saved on the server.</div>
			</div>
		</div>
	</div>
</body>
</html>
<?php
}

/* -------------------- Table renderers -------------------- */
function render_table($rows, $highlightN){
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
			if($highlightN && $v === 'N') $cls = " class='nCell'";
			/* CHANGED: show 'Y' cells in Red color (Availability matrices) */
			if($highlightN && $v === 'Y') $cls = " class='redCell'";
			echo "<td{$cls}>".h($v)."</td>";
		}
		echo "</tr>";
	}
	echo "</table></div>";
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
		echo "<td>".h(isset($row['sessionsite']) ? $row['sessionsite'] : '')."</td>";
		foreach($vaccines as $vx){
			foreach($months as $mk){
				$val = isset($row['cells'][$vx][$mk]) ? (string)$row['cells'][$vx][$mk] : '';
				$cls = ($highlightN && $val==='N') ? " class='nCell'" : "";
				echo "<td{$cls}>".h($val)."</td>";
			}
		}
		echo "</tr>";
	}
	echo "</table></div>";
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($r['block'])."</td>";
		echo "<td>".h($r['facility'])."</td>";
		echo "<td>".h(isset($r['sessionsite']) ? $r['sessionsite'] : '')."</td>";
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($r['block'])."</td>";
		echo "<td>".h($r['facility'])."</td>";
		echo "<td>".h(isset($r['sessionsite']) ? $r['sessionsite'] : '')."</td>";
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
		echo "<td>".h(isset($row['sessionsite']) ? $row['sessionsite'] : '')."</td>";
		foreach($vaccines as $vx){
			foreach($pairs as $p){
				$pk = $p['k'];
				$cell = (isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk])) ? $row['cells'][$vx][$pk] : null;
				if(!$cell || empty($cell['hit'])){
					echo "<td></td><td></td><td></td>";
				} else {
					$a = $cell['a']; $b = $cell['b']; $pct = $cell['pct'];
					$pctStr = ($pct===null) ? '' : (($pct>0?'+':'').round($pct,1).'%');
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
		echo "<td>".h(isset($row['sessionsite']) ? $row['sessionsite'] : '')."</td>";
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
	echo "<th rowspan='2'>LGD Block Name</th>";
	echo "<th rowspan='2'>Health Facility Name</th>";
	echo "<th rowspan='2'>Session Site Name</th>";
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
		echo "<td>".h($row['block'])."</td>";
		echo "<td>".h($row['facility'])."</td>";
		echo "<td>".h(isset($row['sessionsite']) ? $row['sessionsite'] : '')."</td>";

		foreach($months as $mk){
			$valsMonth = [];
			foreach($vaccines as $vx){
				$v = isset($row['vals'][$mk][$vx]) ? $row['vals'][$mk][$vx] : null;
				if($v !== null){
					$valsMonth[$vx] = sprintf('%.10F', (float)$v);
				}
			}
			/* CHANGED: red coloring per new rule (cells differing from Penta; Penta never colored) */
			$redMonth = coadmin_red_cells($valsMonth);
			foreach($vaccines as $vx){
				$v = isset($row['vals'][$mk][$vx]) ? $row['vals'][$mk][$vx] : null;
				$cls = "";
				if($v !== null && isset($redMonth[$vx])){ $cls = " class='redCell'"; }
				echo "<td{$cls}>".h($v===null?'':round($v))."</td>";
			}
		}

		$totVals = [];
		foreach($vaccines as $vx){
			$tv = isset($row['totals'][$vx]) ? $row['totals'][$vx] : null;
			if($tv !== null){
				$totVals[$vx] = sprintf('%.10F', (float)$tv);
			}
		}
		/* CHANGED: red coloring per new rule on totals as well */
		$redTot = coadmin_red_cells($totVals);
		foreach($vaccines as $vx){
			$tv = isset($row['totals'][$vx]) ? $row['totals'][$vx] : null;
			$cls = "";
			if($tv !== null && isset($redTot[$vx])){ $cls = " class='redCell'"; }
			echo "<td{$cls}>".h($tv===null?'':round($tv))."</td>";
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
	$idxBlock = $_SESSION['idxBlock'];
	$idxFac = $_SESSION['idxFac'];
	$idxMonth = $_SESSION['idxMonth'];
	$idxOwner = isset($_SESSION['idxOwner']) ? $_SESSION['idxOwner'] : null;
	$idxRU = isset($_SESSION['idxRU']) ? $_SESSION['idxRU'] : null;
	$idxState = isset($_SESSION['idxState']) ? $_SESSION['idxState'] : null;
	$idxDist = isset($_SESSION['idxDist']) ? $_SESSION['idxDist'] : null;
	/* NEW: Session Site column (all KPIs are now session-site-wise) */
	$idxSessionSite = find_col_index_contains_any($header, ['session site name','session site']);
	$filters = isset($_SESSION['filters']) ? $_SESSION['filters'] : [];
	$fileName = isset($_SESSION['file_name']) ? $_SESSION['file_name'] : 'uploaded.csv';
	$hasApplied = isset($_SESSION['hasApplied']) ? (bool)$_SESSION['hasApplied'] : false;
	$justUploaded = !empty($_SESSION['just_uploaded']);
	unset($_SESSION['just_uploaded']);

	$BASE_VAX = ['BCG','Penta1','Penta3','OPV1','OPV3','MR1','MR2'];

	$ADD_VAX = ['RVV1','RVV2','RVV3','IPV1','IPV2','IPV3','PCV1','PCV2','PCV Booster','HepB0','DPT 1st Booster'];

	/* Build data map per (block, facility) */
	$facData=[];
	$allMonthKeys=[];
	$statesSet=[];
	$distsSet=[];
	foreach($rows as $r){
		$block = isset($r[$idxBlock]) ? trim((string)$r[$idxBlock]) : '';
		$fac = isset($r[$idxFac]) ? trim((string)$r[$idxFac]) : '';
		$sess = ($idxSessionSite!==null && isset($r[$idxSessionSite])) ? trim((string)$r[$idxSessionSite]) : '';
		$monRaw= isset($r[$idxMonth]) ? (string)$r[$idxMonth] : '';
		if($block==='' && $fac==='') continue;
		if(trim($monRaw)==='') continue;
		$mKey = month_key($monRaw);
		$mLbl = month_short_label($monRaw);
		if($mKey===null) continue;

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
		/* CHANGED: session-site-wise key (Block || Facility || Session Site) */
		$key = $block.'||'.$fac.'||'.$sess;
		if(!isset($facData[$key])){
			$facData[$key]=[
				'block'=>$block,'facility'=>$fac,'sessionsite'=>$sess,
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

		if(!isset($facData[$key]['months'][$mKey])){
			$facData[$key]['months'][$mKey]=['label'=>$mLbl,'raw'=>$monRaw,'sums'=>[],'has'=>[]];
		}
		for($ci=$idxMonth+1;$ci<count($header);$ci++){
			$v = as_num_or_null(isset($r[$ci]) ? $r[$ci] : null);
			if($v !== null){
				if(!isset($facData[$key]['months'][$mKey]['sums'][$ci])) $facData[$key]['months'][$mKey]['sums'][$ci] = 0;
				$facData[$key]['months'][$mKey]['sums'][$ci] += $v;
				$facData[$key]['months'][$mKey]['has'][$ci] = true;
			} else {
				if(!isset($facData[$key]['months'][$mKey]['has'][$ci])) $facData[$key]['months'][$mKey]['has'][$ci] = false;
			}
		}
	}

	
	/* FIX (required for the requested t0 red-'Y' display to ever take effect):
	   the target indicator map must be built BEFORE the raw-zero loop below uses it.
	   Previously it was defined only later in this function, so $indicatorIdxTargets was
	   empty here and the t0 KPI ("All Indicators having 0 values but not blank") could
	   never produce any rows. The map itself is unchanged. */
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

	/* Mark raw-row Availability (all target indicators = 0) per facility-month.
	   This is later used by the Availability KPI/table and highlighted export. */
	$availabilityRawZeroHits = [];
	foreach($rows as $r){
		if(count($r) < count($header)) $r = array_pad($r, count($header), '');
		$block = ($idxBlock!==null && isset($r[$idxBlock])) ? trim((string)$r[$idxBlock]) : '';
		$fac   = ($idxFac!==null && isset($r[$idxFac])) ? trim((string)$r[$idxFac]) : '';
		$sess  = ($idxSessionSite!==null && isset($r[$idxSessionSite])) ? trim((string)$r[$idxSessionSite]) : '';
		$mon   = ($idxMonth!==null && isset($r[$idxMonth])) ? (string)$r[$idxMonth] : '';
		if($block==='' && $fac==='') continue;
		if(trim($mon)==='') continue;
		$mKey = month_key($mon);
		if($mKey===null) continue;
		$facKey0 = $block.'||'.$fac.'||'.$sess;
		$allZero = true; $hasAny = false;
		foreach($indicatorIdxTargets as $ci=>$meta){
			$v = as_num_or_null(isset($r[$ci]) ? $r[$ci] : null);
			if($v===null){ $allZero=false; break; }
			$hasAny = true;
			if((float)$v != 0.0){ $allZero=false; break; }
		}
		if($hasAny && $allZero){
			$availabilityRawZeroHits[$facKey0][$mKey] = true;
		}
	}

	/* Aggregate repeated session-site rows: sum indicators per Health Facility Name per month */
	foreach($facData as $facKey=>&$fd){
		foreach($fd['months'] as $mk=>&$mm){
			$vals = [];
			for($ci=$idxMonth+1;$ci<count($header);$ci++){
				if(isset($mm['has'][$ci]) && $mm['has'][$ci]){
					$vals[$ci] = isset($mm['sums'][$ci]) ? $mm['sums'][$ci] : 0;
				} else {
					$vals[$ci] = null;
				}
			}
			$mm['vals'] = $vals;
			$mm['raw_zero_targets'] = !empty($availabilityRawZeroHits[$facKey]) && !empty($availabilityRawZeroHits[$facKey][$mk]);
			unset($mm['sums'], $mm['has']);
		}
	}
	unset($fd);

$monthKeys=array_keys($allMonthKeys);
	sort($monthKeys,SORT_STRING);
	$singleMonthDataset=(count($monthKeys)===1);

	/* Outliers dropdown hidden ONLY for 1-month dataset */
	$showOutliersDropdown = (count($monthKeys) > 1);
	/* Dropouts dropdown visible even for 1-month dataset */
	$showDropoutsDropdown = true;

	/* Meta line */
	$stateName = '—';
	$distName = '—';
	if(count($statesSet)===1){ foreach($statesSet as $k=>$v){ $stateName=$k; break; } }
	elseif(count($statesSet)>1){ $stateName='Multiple'; }
	if(count($distsSet)===1){ foreach($distsSet as $k=>$v){ $distName=$k; break; } }
	elseif(count($distsSet)>1){ $distName='Multiple'; }

	$durationStr = '—';
	if(!empty($monthKeys)){
		$minYM = $monthKeys[0];
		$maxYM = $monthKeys[count($monthKeys)-1];
		$span = months_span_inclusive($minYM,$maxYM);
		if($span!==null){
			if($minYM===$maxYM){
				$durationStr = (int)$span.' month'.(((int)$span)===1?'':'s').' ('.month_label_from_key_my($minYM).')';
			} else {
				$durationStr = (int)$span.' month'.(((int)$span)===1?'':'s').' ('.month_label_from_key_my($minYM).'–'.month_label_from_key_my($maxYM).')';
			}
		}
	}

	/* Duration HTML (line break before bracket text as requested) */
	$durationStrHtml = h($durationStr);
	$durationStrHtml = preg_replace('/\s*\(/','<br>(', $durationStrHtml, 1);

	/* Target indicator map (built earlier in this function, before the raw-zero availability loop) */
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
	$ADD_VAX = ['RVV1','RVV2','RVV3','IPV1','IPV2','IPV3','PCV1','PCV2','PCV Booster','HepB0','DPT 1st Booster'];
	$KEY_VAX = $BASE_VAX;
	if(isset($idxByShortAll['FIC-Total'])) $KEY_VAX[] = 'FIC-Total';

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
	$iIPV1=$find('9.1.11.');
	$iIPV2=$find('9.1.12.');
	$iIPV3=$find('9.2.1.');
	$iPCVB=$find('9.2.4.');
	$iDPTB=$find('9.4.2.');
	$iSessP = $find('sessions planned');
	$iSessH = $find('sessions held');
	// UWIN headers are usually "Session Planned" / "Session Held"
	if($iSessP===null) $iSessP = find_col_index_contains_any($header, ['session planned','sessions planned']);
	if($iSessH===null) $iSessH = find_col_index_contains_any($header, ['session held','sessions held']);

	/* NEW: Beneficiaries columns (UWIN sample: columns N–Q) */
	$iBenPW = find_col_index_contains_any($header, ['number of pregnant women vaccinated','pregnant women vaccinated']);
	$iBenInf = find_col_index_contains_any($header, ['number of infants (0-1 year) vaccinated','infants (0-1 year) vaccinated','infants 0-1 year vaccinated']);
	$iBenChild = find_col_index_contains_any($header, ['number of children (>1 year) vaccinated','children (>1 year) vaccinated','children >1 year vaccinated']);
	$iBenAdol = find_col_index_contains_any($header, ['number of adolescents vaccinated','adolescents vaccinated']);

	/* NEW: Td columns (for "Total Beneficiaries vaccinated = 0" KPI) */
	$iBenTd1 = find_col_index_contains_any($header, ['number of women vaccinated with td 1']);
	$iBenTd2 = find_col_index_contains_any($header, ['number of women vaccinated with td 2']);
	$iBenTdB = find_col_index_contains_any($header, ['number of women vaccinated with td-booster','number of women vaccinated with td booster']);
	$iBenTd10 = find_col_index_contains_any($header, ['number of adolescents vaccinated with td10','adolescents vaccinated with td10']);
	$iBenTd16 = find_col_index_contains_any($header, ['number of adolescents vaccinated with td16','adolescents vaccinated with td16']);

	// Prefer UWIN vaccine columns (short names) when available
	$getIdx = function($short) use ($idxByShortAll){ return isset($idxByShortAll[$short]) ? $idxByShortAll[$short] : null; };
	$use = function(&$var, $short) use ($getIdx){ $tmp = $getIdx($short); if($tmp!==null) $var = $tmp; };

	$use($iP1,'Penta1');
	$use($iP2,'Penta2');
	$use($iP3,'Penta3');
	$use($iO1,'OPV1');
	$use($iO2,'OPV2');
	$use($iO3,'OPV3');
	$use($iMR1,'MR1');
	$use($iMR2,'MR2');
	$use($iRVV1,'RVV1');
	$use($iRVV2,'RVV2');
	$use($iRVV3,'RVV3');
	$use($iPCV1,'PCV1');
	$use($iPCV2,'PCV2');
	$use($iIPV1,'IPV1');
	$use($iIPV2,'IPV2');
	$use($iIPV3,'IPV3');
	$use($iPCVB,'PCV Booster');
	$use($iDPTB,'DPT 1st Booster');


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
	$PAIR_DEFAULTS = ['Penta1→Penta3','MR1→MR2','BCG→MR1','Penta3→MR1'];

	$expandAll = function($arr,$all){
		if(!is_array($arr)) $arr=[];
		// In this UI, an empty selection means "Select All"
		if(empty($arr)) return $all;
		if(in_array('__ALL__',$arr,true)) return $all;
		return $arr;
	};

	$filters['blocks'] = $expandAll(isset($filters['blocks']) ? $filters['blocks'] : [], array_keys($allBlocks));
	$filters['months'] = $expandAll(isset($filters['months']) ? $filters['months'] : [], array_keys($allMonths));
	$filters['ownership'] = $expandAll(isset($filters['ownership']) ? $filters['ownership'] : [], ['Public','Private']);
	$filters['ru'] = $expandAll(isset($filters['ru']) ? $filters['ru'] : [], ['Rural','Urban']);
	$filters['outliers_inc'] = $expandAll(isset($filters['outliers_inc']) ? $filters['outliers_inc'] : [], $OUT_INC_ALL);
	$filters['outliers_drop'] = $expandAll(isset($filters['outliers_drop']) ? $filters['outliers_drop'] : [], $OUT_DROP_ALL);
	// Key Indicators: empty means "Select All" (includes FIC-Total when present in this dataset)
	$filters['outliers_vax'] = $expandAll(isset($filters['outliers_vax']) ? $filters['outliers_vax'] : [], $KEY_VAX);
	/*
	  Additional Filter (Additional Indicators):
	  - IMPORTANT requirement: after upload, NOTHING should be selected by default.
	  - So, unlike other filters, an empty selection means "Select None" (NOT "Select All").
	  - "Select All" is still supported (either via UI selecting all boxes, or '__ALL__').
	*/
	$filters['add_vax'] = isset($filters['add_vax']) ? $filters['add_vax'] : [];
	if(!is_array($filters['add_vax'])) $filters['add_vax'] = [$filters['add_vax']];
	if(in_array('__ALL__', $filters['add_vax'], true)){
		$filters['add_vax'] = $ADD_VAX;
	} else {
		$allowedAdd = array_fill_keys($ADD_VAX, true);
		$tmpAdd = [];
		foreach($filters['add_vax'] as $v){
			$v = trim((string)$v);
			if($v !== '' && isset($allowedAdd[$v])) $tmpAdd[] = $v;
		}
		$filters['add_vax'] = $tmpAdd;
	}
	$filters['drop_ranges'] = $expandAll(isset($filters['drop_ranges']) ? $filters['drop_ranges'] : [], $DROP_RANGE_ALL);
	$filters['drop_pairs'] = $expandAll(isset($filters['drop_pairs']) ? $filters['drop_pairs'] : [], $PAIR_DEFAULTS);

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

	$facFiltered = [];
	foreach($facData as $key=>$fd){
		$__blk = isset($fd['block']) ? trim((string)$fd['block']) : '';
		$__blkLabel = display_block_label($__blk);
		if(!isset($selBlocks[$__blk]) && !isset($selBlocks[$__blkLabel])) continue;
		if($idxOwner!==null && !isset($selOwner[$fd['ownership']])) continue;
		if($idxRU!==null && !isset($selRU[$fd['ru']])) continue;

		$monthsKeep=[];
		foreach($fd['months'] as $mk=>$md){
			if(isset($selMonths[$mk])) $monthsKeep[$mk]=$md;
		}
		if(empty($monthsKeep)) continue;

		$facFiltered[$key]=[
			'block'=>$fd['block'],
			'facility'=>$fd['facility'],
			'sessionsite'=>isset($fd['sessionsite']) ? $fd['sessionsite'] : '',
			'ownership'=>$fd['ownership'],
			'ru'=>$fd['ru'],
			'months'=>$monthsKeep
		];
	}

	/* Independent KPIs */
	/* NOTE: Counts should be based on distinct facilities; do NOT exclude facilities when Block is blank.
	   Also, facility names should be de-duplicated case-insensitively / whitespace-insensitively to match Excel pivots. */
	$globalFacilitySet = [];
	$globalFacilityMeta = []; // facilityKey => ['display'=>..,'ownership'=>..,'ru'=>..] (first non-empty wins; becomes Mixed if conflict)
	$globalBlocksSet = [];
	foreach($facData as $fd){
		$facDisp = isset($fd['facility']) ? trim((string)$fd['facility']) : '';
		$facKey  = ($facDisp!=='') ? normalize_facility_key($facDisp) : '';
		if($facKey!==''){
			$globalFacilitySet[$facKey] = true;
			if(!isset($globalFacilityMeta[$facKey])){
				$globalFacilityMeta[$facKey] = ['display'=>$facDisp,'ownership'=>'','ru'=>''];
			} else {
				// keep first display label (do not change)
			}
			$ownRaw = isset($fd['ownership']) ? trim((string)$fd['ownership']) : '';
			$ruRaw  = isset($fd['ru']) ? trim((string)$fd['ru']) : '';
			if($ownRaw!==''){
				$ownNorm = normalize_ownership($ownRaw);
				if($globalFacilityMeta[$facKey]['ownership']==='') $globalFacilityMeta[$facKey]['ownership']=$ownNorm;
				elseif($globalFacilityMeta[$facKey]['ownership']!==$ownNorm) $globalFacilityMeta[$facKey]['ownership']='Mixed';
			}
			if($ruRaw!==''){
				$ruNorm = normalize_ru($ruRaw);
				if($globalFacilityMeta[$facKey]['ru']==='') $globalFacilityMeta[$facKey]['ru']=$ruNorm;
				/* keep first RU classification to avoid double-count / mismatch with total */
			}
		}
		$blockRaw = isset($fd['block']) ? trim((string)$fd['block']) : '';
		if($blockRaw!==''){
			$globalBlocksSet[$blockRaw] = true; // IMPORTANT: do not count blank block names
		}
	}
	$globalDen = count($globalFacilitySet);

	/* NEW: session-site-level denominator (distinct Block||Facility||Session Site, case-insensitive)
	   used for KPI summary percentages and Overall Score, since all KPIs are now session-site-wise.
	   CHANGED: rows with a BLANK Session Site Name are NOT counted as session sites, so the figure
	   matches a pivot distinct count of the Session Site Name column (blanks excluded). */
	$globalSessionSiteSet = [];
	foreach($facData as $fdKey=>$fd){
		if(trim((string)(isset($fd['sessionsite'])?$fd['sessionsite']:''))==='') continue;
		$globalSessionSiteSet[normalize_facility_key($fdKey)] = true;
	}
	$ssDen = count($globalSessionSiteSet);

	$globalPub=0; $globalPri=0; $globalRur=0; $globalUrb=0;
	foreach($globalFacilityMeta as $meta){
		$o = normalize_header($meta['ownership']);
		if($o==='public') $globalPub++; elseif($o==='private') $globalPri++;
		$ru = normalize_header($meta['ru']);
		if($ru==='rural') $globalRur++; elseif($ru==='urban') $globalUrb++;
	}
	$globalBlocksCount = count($globalBlocksSet);

/* Selected months ordered */
	$selMonthKeysOrdered = $filters['months'];
	if(empty($selMonthKeysOrdered)) $selMonthKeysOrdered = array_keys($allMonths);
	$selMonthLabelsOrdered = [];
	foreach($selMonthKeysOrdered as $mk){ $selMonthLabelsOrdered[$mk] = isset($allMonths[$mk]) ? $allMonths[$mk] : $mk; }

	
	$t0=[]; $t0_facilities=[]; $t0_any_facilities=[]; $t0_all_facilities=[];
	$t0[] = array_merge(['LGD Block Name','Health Facility Name','Session Site Name'], array_values($selMonthLabelsOrdered));
	$totalMonthsSel = count($selMonthKeysOrdered);
	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
		$hitCount = 0;
		foreach($selMonthKeysOrdered as $mk){
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$isZero = false;
			if($md){
				/* IMPORTANT: facility-month should be Y only when at least one RAW row
				   for that facility-month has all target indicators explicitly equal to 0.
				   Do not derive Y from consolidated sums alone. */
				$isZero = !empty($md['raw_zero_targets']);
			}
			$row[] = $isZero ? 'Y' : 'N';
			if($isZero) $hitCount++;
		}
		if($hitCount > 0){
			$t0_facilities[$key]=true;
			$t0[]=$row;
			if($totalMonthsSel>0 && $hitCount === $totalMonthsSel){
				$t0_all_facilities[$key]=true;
			} else {
				$t0_any_facilities[$key]=true;
			}
		}
	}

	/* Same values */
	$t7=[]; $t7_facilities=[];
	$t7[] = array_merge(['LGD Block Name','Health Facility Name','Session Site Name'], array_values($selMonthLabelsOrdered));
	$repeatHitsByFac = [];
	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']), $fd['facility'], $fd['sessionsite']];
		$anyY = false; $allY = true;
		foreach($selMonthKeysOrdered as $mk){
			$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
			$isRepeat = false;
			if($md){
				$firstVal = null; $ok = true; $hasAny = false;
				for($ci=$idxMonth+1;$ci<count($header);$ci++){
					$v = isset($md['vals'][$ci]) ? $md['vals'][$ci] : null;
					if($v === null){ $ok = false; break; }
					if((float)$v == 0.0){ $ok = false; break; }
					$vv = sprintf('%.10F', (float)$v);
					if($firstVal === null){ $firstVal = $vv; $hasAny = true; }
					else { if($vv !== $firstVal){ $ok = false; break; } }
				}
				$isRepeat = ($hasAny && $ok);
			}
			$row[] = $isRepeat ? 'Y' : 'N';
			if($isRepeat){
				$anyY = true;
				if(!isset($repeatHitsByFac[$key])) $repeatHitsByFac[$key] = [];
				$repeatHitsByFac[$key][$mk] = true;
			} else {
				$allY = false;
			}
		}
		if($anyY){ $t7_facilities[$key] = true; $t7[] = $row; }
		if($anyY && $allY){ if(!isset($t7_all_facilities)) $t7_all_facilities=[]; $t7_all_facilities[$key]=true; }
	}
	$_SESSION['pink_repeat_hits'] = $repeatHitsByFac;

	/* NEW KPI (Availability): Total Beneficiaries vaccinated = 0
	   Y when, for a session-site-month, the total of:
	   Number of Pregnant Women vaccinated + Number of Infants (0-1 year) vaccinated +
	   Number of Children (>1 year) vaccinated + Number of Adolescents vaccinated +
	   Number of Women vaccinated with Td 1 + Td 2 + Td-Booster +
	   Number of Adolescents vaccinated with td10 + td16
	   equals 0 (at least one of these columns must have a reported value for that month). */
	$benZeroIdxList = [];
	foreach([$iBenPW,$iBenInf,$iBenChild,$iBenAdol,$iBenTd1,$iBenTd2,$iBenTdB,$iBenTd10,$iBenTd16] as $biTmp){
		if($biTmp!==null) $benZeroIdxList[] = $biTmp;
	}
	$t9=[]; $t9_facilities=[]; $t9_any_facilities=[]; $t9_all_facilities=[];
	$t9[] = array_merge(['LGD Block Name','Health Facility Name','Session Site Name'], array_values($selMonthLabelsOrdered));
	if(!empty($benZeroIdxList)){
		$totalMonthsSel = count($selMonthKeysOrdered);
		foreach($facFiltered as $key=>$fd){
			$row = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
			$hitCount = 0;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$isZero = false;
				if($md){
					$sumBen = 0.0; $hasBen = false;
					foreach($benZeroIdxList as $bi){
						$v = isset($md['vals'][$bi]) ? $md['vals'][$bi] : null;
						if($v !== null){ $hasBen = true; $sumBen += (float)$v; }
					}
					if($hasBen && $sumBen == 0.0) $isZero = true;
				}
				$row[] = $isZero ? 'Y' : 'N';
				if($isZero) $hitCount++;
			}
			if($hitCount > 0){
				$t9_facilities[$key]=true;
				$t9[]=$row;
				if($totalMonthsSel>0 && $hitCount === $totalMonthsSel){
					$t9_all_facilities[$key]=true;
				} else {
					$t9_any_facilities[$key]=true;
				}
			}
		}
	}

	/* Missing Indicator */
	$t2Title='Key Missing Indicators';
	$selVaxList = array_values(array_unique(array_merge(
		isset($filters['outliers_vax']) ? (array)$filters['outliers_vax'] : [],
		isset($filters['add_vax']) ? (array)$filters['add_vax'] : []
	)));
	if(empty($selVaxList)){ $selVaxList = $BASE_VAX; }

	$idxByShortLocal = $idxByShortAll;
	$tmp = [];
	foreach($selVaxList as $vx){ if(isset($idxByShortLocal[$vx])) $tmp[] = $vx; }
	$selVaxList = !empty($tmp) ? $tmp : $BASE_VAX;

	$t2=[]; $t2_facilities=[];
	$flatHeader = ['LGD Block Name','Health Facility Name','Session Site Name'];
	foreach($selVaxList as $vx){
		foreach($selMonthKeysOrdered as $mk){
			$flatHeader[] = $vx.' '.(isset($allMonths[$mk]) ? $allMonths[$mk] : $mk);
		}
	}
	$t2[] = $flatHeader;

	$t2_matrix_cache = [];
	$blankCountsByVax = [];
	$blankAllCountsByVax = [];
	foreach($selVaxList as $vx){ $blankCountsByVax[$vx]=0; $blankAllCountsByVax[$vx]=0; }

	foreach($facFiltered as $key=>$fd){
		$row = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
		$anyBlank=false;
		$allMonthsHaveBlank=true;
		$cellMap = [];
		foreach($selVaxList as $vx){
			$ci = isset($idxByShortLocal[$vx]) ? $idxByShortLocal[$vx] : null;
			$hasBlankForVx = false;
			$vxAllBlank = true;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$isBlank = false;
				if($md && $ci!==null){
					$v = isset($md['vals'][$ci]) ? $md['vals'][$ci] : null;
					$isBlank = ($v===null);
				}
				$cellMap[$vx][$mk] = $isBlank ? 'Y' : 'N';
				if($isBlank){ $anyBlank=true; $hasBlankForVx=true; } else { $vxAllBlank = false; }
				$row[] = $cellMap[$vx][$mk];
			}
			if($hasBlankForVx) $blankCountsByVax[$vx] = $blankCountsByVax[$vx] + 1;
			if($vxAllBlank) $blankAllCountsByVax[$vx] = $blankAllCountsByVax[$vx] + 1;
		}
		if($anyBlank){
			// all-month: each selected month has at least one blank among selected indicators
			foreach($selMonthKeysOrdered as $mk){
				$has=false;
				foreach($selVaxList as $vx){ if(isset($cellMap[$vx][$mk]) && $cellMap[$vx][$mk]==='Y'){ $has=true; break; } }
				if(!$has){ $allMonthsHaveBlank=false; break; }
			}
			if($allMonthsHaveBlank){ if(!isset($t2_all_facilities)) $t2_all_facilities=[]; $t2_all_facilities[$key]=true; }
			$t2_facilities[$key]=true;
			$t2[] = $row;
			$t2_matrix_cache[$key] = [
				'block'=>display_block_label($fd['block']),
				'facility'=>$fd['facility'],
				'sessionsite'=>$fd['sessionsite'],
				'cells'=>$cellMap
			];
		}
	}

	arsort($blankCountsByVax);
	arsort($blankAllCountsByVax);
	// Any-month (only) counts exclude facilities that are blank in ALL months for that indicator
	$blankAnyOnlyCountsByVax = [];
	foreach($selVaxList as $vx){
		$blankAnyOnlyCountsByVax[$vx] = max(0, (int)$blankCountsByVax[$vx] - (int)$blankAllCountsByVax[$vx]);
	}
	arsort($blankAnyOnlyCountsByVax);
	$top3BlankAny = [];

	foreach($blankAnyOnlyCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankAny[] = $vx.' ('.$cnt.')'; if(count($top3BlankAny)===3) break; }
	$top3BlankAll = [];
	foreach($blankAllCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankAll[] = $vx.' ('.$cnt.')'; if(count($top3BlankAll)===3) break; }
	$top3BlankOverall = [];
	foreach($blankCountsByVax as $vx=>$cnt){ if($cnt<=0) continue; $top3BlankOverall[] = $vx.' ('.$cnt.')'; if(count($top3BlankOverall)===3) break; }

	$top3Blank = $top3BlankAny;
	
	foreach($blankCountsByVax as $vx=>$cnt){
		if($cnt<=0) continue;
		$top3Blank[] = $vx.' ('.$cnt.')';
		if(count($top3Blank)===3) break;
	}

	/* CHANGED: "Planned but not held" (Sessions Planned > Sessions Held).
	   CHANGED (format only): table mirrors the Outliers-style two-level layout —
	   per month (and All months): Sessions Planned | Sessions Held | % not held,
	   filled only for the months that violate (Held < Planned). Flagging logic unchanged. */
	$t6_facilities=[]; $t6_any_facilities=[]; $t6_all_facilities=[];
	$t6_web = ['months'=>$selMonthKeysOrdered, 'monthLabels'=>$selMonthLabelsOrdered, 'rows'=>[]];
	$t6_export = [];
	$t6_head1 = ['LGD Block Name','Health Facility Name','Session Site Name'];
	foreach($selMonthKeysOrdered as $mk){
		$lbl = isset($selMonthLabelsOrdered[$mk]) ? $selMonthLabelsOrdered[$mk] : $mk;
		$t6_head1[] = $lbl; $t6_head1[] = ''; $t6_head1[] = '';
	}
	$t6_head1[] = 'All months'; $t6_head1[] = ''; $t6_head1[] = '';
	$t6_head2 = ['','',''];
	for($gi6=0; $gi6 < count($selMonthKeysOrdered)+1; $gi6++){
		$t6_head2[] = 'Sessions Planned'; $t6_head2[] = 'Sessions Held'; $t6_head2[] = '% not held';
	}
	$t6_export[] = $t6_head1;
	$t6_export[] = $t6_head2;
	if($iSessP!==null && $iSessH!==null){
		$totalMonthsSel = count($selMonthKeysOrdered);
		foreach($facFiltered as $key=>$fd){
			$cells=[]; $sumP=0; $sumH=0; $hitCount=0; $anyHit=false;
			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$P = ($md && isset($md['vals'][$iSessP])) ? $md['vals'][$iSessP] : null;
				$H = ($md && isset($md['vals'][$iSessH])) ? $md['vals'][$iSessH] : null;
				if($P!==null) $sumP+=$P;
				if($H!==null) $sumH+=$H;
				$hit=false; $pct=null;
				if($P!==null && $P>0 && $H!==null && $H<$P){
					$hit=true; $anyHit=true; $hitCount++;
					$pct=($P-$H)/$P*100;
				}
				$cells[$mk]=['p'=>$P,'h'=>$H,'pct'=>$pct,'hit'=>$hit];
			}
			$totHit=false; $totPct=null;
			if($sumP>0 && $sumH<$sumP){
				$totHit=true; $anyHit=true;
				$totPct=($sumP-$sumH)/$sumP*100;
			}
			if($anyHit){
				$t6_facilities[$key]=true;
				if($totalMonthsSel>0 && $hitCount === $totalMonthsSel){
					$t6_all_facilities[$key]=true;
				} else {
					// includes cases where only totals violates
					$t6_any_facilities[$key]=true;
				}
				$t6_web['rows'][$key]=[
					'block'=>display_block_label($fd['block']),
					'facility'=>$fd['facility'],
					'sessionsite'=>$fd['sessionsite'],
					'cells'=>$cells,
					'totals'=>['p'=>$sumP,'h'=>$sumH,'pct'=>$totPct,'hit'=>$totHit]
				];
				$line=[display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
				foreach($selMonthKeysOrdered as $mk){
					$c=$cells[$mk];
					if($c['hit']){ $line[]=round($c['p']); $line[]=round($c['h']); $line[]=round($c['pct'],1).'%'; }
					else { $line[]=''; $line[]=''; $line[]=''; }
				}
				if($totHit){ $line[]=round($sumP); $line[]=round($sumH); $line[]=round($totPct,1).'%'; }
				else { $line[]=''; $line[]=''; $line[]=''; }
				$t6_export[]=$line;
			}
		}
	}

		/* NEW KPI: Avg Beneficiaries per session < 5 (Beneficiaries = Pregnant Women + Infants (0-1y) + Children (>1y) + Adolescents)
	   Table format requested:
	   - Header row 1: Month groups (plus "All months")
	   - Header row 2: Session Held / Beneficiaries / Average
	   - Rows: values per facility, shown only for facilities that violate in any month and/or in totals
	*/
	$t8_facilities=[]; $t8_any_facilities=[]; $t8_all_facilities=[];
	$t8_web = ['months'=>$selMonthKeysOrdered, 'monthLabels'=>$selMonthLabelsOrdered, 'rows'=>[]];
	$t8_export = [];

	$exportMonths = $selMonthKeysOrdered;
	$exportMonths[] = '__ALL__';
	$exportMonthLabels = $selMonthLabelsOrdered;
	$exportMonthLabels['__ALL__'] = 'All months';

	$head1 = ['LGD Block Name','Health Facility Name','Session Site Name'];
	foreach($exportMonths as $mk){
		$lbl = isset($exportMonthLabels[$mk]) ? $exportMonthLabels[$mk] : $mk;
		$head1[] = $lbl; $head1[] = ''; $head1[] = '';
	}
	$head2 = ['','',''];
	foreach($exportMonths as $mk){
		$head2[] = 'Session Held';
		$head2[] = 'Beneficiaries';
		$head2[] = 'Average';
	}
	$t8_export[] = $head1;
	$t8_export[] = $head2;

	if($iSessH!==null && $iBenPW!==null && $iBenInf!==null && $iBenChild!==null && $iBenAdol!==null){
		$totalMonthsSel = count($selMonthKeysOrdered);
		foreach($facFiltered as $key=>$fd){
			$cells = [];
			$sumBen=0; $sumHeld=0;
			$hitCount=0;

			foreach($selMonthKeysOrdered as $mk){
				$md = isset($fd['months'][$mk]) ? $fd['months'][$mk] : null;
				$H = ($md && isset($md['vals'][$iSessH])) ? $md['vals'][$iSessH] : null;
				$bPW = ($md && isset($md['vals'][$iBenPW])) ? $md['vals'][$iBenPW] : null;
				$bInf = ($md && isset($md['vals'][$iBenInf])) ? $md['vals'][$iBenInf] : null;
				$bChild = ($md && isset($md['vals'][$iBenChild])) ? $md['vals'][$iBenChild] : null;
				$bAdol = ($md && isset($md['vals'][$iBenAdol])) ? $md['vals'][$iBenAdol] : null;

				if($H!==null) $sumHeld += $H;

				$benSum = 0; $hasBen=false;
				foreach([$bPW,$bInf,$bChild,$bAdol] as $bv){
					if($bv!==null){ $benSum += $bv; $hasBen=true; }
				}
				if($hasBen) $sumBen += $benSum;

				$avg = null; $flag=false;
				if($H!==null && $H>0 && $hasBen){
					$avg = $benSum / $H;
					if($avg < 5){
						$flag = true;
						$hitCount++;
					}
				}

				$cells[$mk] = [
					'held'=>$H,
					'ben'=> $hasBen ? $benSum : null,
					'avg'=> $avg,
					'flag'=>$flag
				];
			}

			$avgTot = null; $totFlag=false;
			if($sumHeld>0){
				$avgTot = $sumBen / $sumHeld;
				if($avgTot < 5) $totFlag=true;
			}

			$anyFlag = $totFlag;
			foreach($cells as $mk=>$cinfo){
				if(!empty($cinfo['flag'])){ $anyFlag=true; break; }
			}

			if($anyFlag){
				$t8_facilities[$key]=true;

				if($totalMonthsSel>0 && $hitCount === $totalMonthsSel){
					$t8_all_facilities[$key]=true;
				} else {
					$t8_any_facilities[$key]=true;
				}

				// Web rows (two-level header rendering)
				$t8_web['rows'][$key] = [
					'block'=>display_block_label($fd['block']),
					'facility'=>$fd['facility'],
					'sessionsite'=>$fd['sessionsite'],
					'cells'=>$cells,
					'totals'=>['held'=>$sumHeld,'ben'=>$sumBen,'avg'=>$avgTot,'flag'=>$totFlag]
				];

				// Export rows (Excel uses simple table: month labels repeated across 3 columns + a subheader row as row 2)
				$line = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
				foreach($selMonthKeysOrdered as $mk){
				$ci = $cells[$mk];
				if(!empty($ci['flag'])){
					$line[] = ($ci['held']===null?'':round($ci['held']));
					$line[] = ($ci['ben']===null?'':round($ci['ben']));
					$line[] = ($ci['avg']===null?'':round($ci['avg'],1));
				} else {
					$line[] = '';
					$line[] = '';
					$line[] = '';
				}
			}
				if($totFlag){
				$line[] = round($sumHeld);
				$line[] = round($sumBen);
				$line[] = ($avgTot===null?'':round($avgTot,1));
				} else {
				$line[] = '';
				$line[] = '';
				$line[] = '';
				}

				$t8_export[] = $line;
			}
		}
	}

	/* Outliers */
	$incBucketsSel = array_fill_keys((array)$filters['outliers_inc'], true);
	$dropBucketsSel= array_fill_keys((array)$filters['outliers_drop'], true);

	$pairList = [];
	for($i=0;$i<count($selMonthKeysOrdered)-1;$i++){
		$m1 = $selMonthKeysOrdered[$i];
		$m2 = $selMonthKeysOrdered[$i+1];
		$pairKey = $m1.'|'.$m2;
		$pairList[] = [
			'k'=>$pairKey,
			'm1'=>$m1,'m2'=>$m2,
			'm1lbl'=> isset($selMonthLabelsOrdered[$m1]) ? $selMonthLabelsOrdered[$m1] : $m1,
			'm2lbl'=> isset($selMonthLabelsOrdered[$m2]) ? $selMonthLabelsOrdered[$m2] : $m2,
		];
	}

	$bucketHit = function($p) use ($incBucketsSel,$dropBucketsSel){
		if($p>0){
			if(isset($incBucketsSel['INC_LOW']) && $p>=25 && $p<=50.49) return true;
			if(isset($incBucketsSel['INC_MOD']) && $p>=50.50 && $p<=100) return true;
			if(isset($incBucketsSel['INC_EXT']) && $p>100) return true;
		}
		elseif($p<0){
			if(isset($dropBucketsSel['DROP_LOW']) && $p<=-25 && $p>=-50.49) return true;
			if(isset($dropBucketsSel['DROP_MOD']) && $p<=-50.50 && $p>=-100) return true;
			if(isset($dropBucketsSel['DROP_EXT']) && $p<-100) return true;
		}
		return false;
	};

	$t3_facilities=[]; $t3_rows_map=[]; $t3_hit_map=[];
	foreach($facFiltered as $key=>$fd){
		$any=false; $cells=[];
		foreach($selVaxList as $vx){
			if(!isset($idxByShortLocal[$vx])) continue;
			$ci = $idxByShortLocal[$vx];
			foreach($pairList as $p){
				$m1=$p['m1']; $m2=$p['m2']; $pk=$p['k'];
				$v1 = (isset($fd['months'][$m1]) && isset($fd['months'][$m1]['vals'][$ci])) ? $fd['months'][$m1]['vals'][$ci] : null;
				$v2 = (isset($fd['months'][$m2]) && isset($fd['months'][$m2]['vals'][$ci])) ? $fd['months'][$m2]['vals'][$ci] : null;
				$pc = pct_change($v1,$v2);
				$hit = false; $pctVal = null;
				if($pc!==null){
					$pctVal = $pc*100;
					if($bucketHit($pctVal)){
						$hit = true; $any = true;
						$t3_hit_map[$key][$m1][$vx]=true;
						$t3_hit_map[$key][$m2][$vx]=true;
					}
				}
				$cells[$vx][$pk] = ['a'=>$v1,'b'=>$v2,'pct'=>$pctVal,'hit'=>$hit];
			}
		}
		if($any){
			$t3_facilities[$key]=true;
			$t3_rows_map[$key]=[
				'block'=>display_block_label($fd['block']),
				'facility'=>$fd['facility'],
				'sessionsite'=>$fd['sessionsite'],
				'cells'=>$cells
			];
		}
	}
	
	/* Any month-pair vs All month-pairs for Outliers (facility-level) */
	$t3_any_facilities = [];
	$t3_all_facilities = [];
	$totalPairs = count($pairList);
	if($totalPairs > 0){
		foreach($t3_rows_map as $fkey=>$row){
			$pairHits = 0;
			foreach($pairList as $p){
				$pk = $p['k'];
				$hit=false;
				// hit if any selected vaccine hits this pair
				foreach($selVaxList as $vx){
					if(isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk]) && !empty($row['cells'][$vx][$pk]['hit'])){
						$hit=true; break;
					}
				}
				if($hit) $pairHits++;
			}
			if($pairHits === $totalPairs) $t3_all_facilities[$fkey]=true;
			else $t3_any_facilities[$fkey]=true;
		}
	} else {
		// If only one month selected, treat any hits as "Any month"
		foreach($t3_rows_map as $fkey=>$row){ $t3_any_facilities[$fkey]=true; }
	}

$_SESSION['pink_outlier_hits'] = $t3_hit_map;

	/* Top-3 indicators for Outliers (Any month-pair vs All month-pairs) */
	$top3OutAny = [];
	$top3OutAll = [];
	$outAnyCounts = [];
	$outAllCounts = [];
	foreach($selVaxList as $vx){ $outAnyCounts[$vx]=0; $outAllCounts[$vx]=0; }
	foreach($t3_rows_map as $row){
		foreach($selVaxList as $vx){
			$anyHit=false; $allHit=true; $hasPair=false;
			foreach($pairList as $p){
				$pk = $p['k'];
				$hasPair=true;
				$cell = (isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk])) ? $row['cells'][$vx][$pk] : null;
				$hit = ($cell && !empty($cell['hit']));
				if($hit) $anyHit=true; else $allHit=false;
			}
			if($hasPair && $anyHit) $outAnyCounts[$vx] = $outAnyCounts[$vx] + 1;
			if($hasPair && $allHit) $outAllCounts[$vx] = $outAllCounts[$vx] + 1;
		}
	}
	arsort($outAnyCounts);
	arsort($outAllCounts);
	// Any-month-pair (only) counts exclude facilities that hit ALL month-pairs for that indicator
	$outAnyOnlyCounts = [];
	foreach($selVaxList as $vx){
		$outAnyOnlyCounts[$vx] = max(0, (int)$outAnyCounts[$vx] - (int)$outAllCounts[$vx]);
	}
	arsort($outAnyOnlyCounts);
	foreach($outAnyOnlyCounts as $vx=>$cnt){ if($cnt<=0) continue; $top3OutAny[] = $vx.' ('.$cnt.')'; if(count($top3OutAny)===3) break; }
	foreach($outAllCounts as $vx=>$cnt){ if($cnt<=0) continue; $top3OutAll[] = $vx.' ('.$cnt.')'; if(count($top3OutAll)===3) break; }
	$outOverallCounts = $outAnyCounts;
	arsort($outOverallCounts);
	$top3OutOverall = [];
	foreach($outOverallCounts as $vx=>$cnt){ if($cnt<=0) continue; $top3OutOverall[] = $vx.' ('.$cnt.')'; if(count($top3OutOverall)===3) break; }

	/* UPDATED export to match Outliers table */
	$t3_export = [];
	$t3_export_header = ['LGD Block Name','Health Facility Name','Session Site Name'];
	foreach($selVaxList as $vx){
		foreach($pairList as $p){
			$t3_export_header[] = $vx.' '.$p['m1lbl'];
			$t3_export_header[] = $vx.' '.$p['m2lbl'];
			$t3_export_header[] = $vx.' % Change ('.$p['m1lbl'].'–'.$p['m2lbl'].')';
		}
	}
	$t3_export[] = $t3_export_header;
	foreach($t3_rows_map as $row){
		$line = [$row['block'],$row['facility'],isset($row['sessionsite'])?$row['sessionsite']:''];
		foreach($selVaxList as $vx){
			foreach($pairList as $p){
				$pk = $p['k'];
				$cell = (isset($row['cells'][$vx]) && isset($row['cells'][$vx][$pk])) ? $row['cells'][$vx][$pk] : null;
				if(!$cell || empty($cell['hit'])){
					$line[] = ''; $line[] = ''; $line[] = '';
				} else {
					$a = $cell['a']; $b = $cell['b']; $pct = $cell['pct'];
					$pctStr = ($pct===null) ? '' : (($pct>0?'+':'').round($pct,1).'%');
					$line[] = ($a===null?'':round($a));
					$line[] = ($b===null?'':round($b));
					$line[] = $pctStr;
				}
			}
		}
		$t3_export[] = $line;
	}

	/* Dropouts */
	$selDropRanges = array_fill_keys((array)$filters['drop_ranges'], true);
	/* updated ranges per request */
	$dropMatch = function($pct) use ($selDropRanges){
		if(isset($selDropRanges['R5_10']) && $pct>=5 && $pct<=10.99) return true;
		if(isset($selDropRanges['R11_20']) && $pct>=11 && $pct<=19.99) return true;
		if(isset($selDropRanges['R20P']) && $pct>=20) return true;
		return false;
	};

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
	$selectedPairs = array_keys($selectedPairs);

	$drop_pair_map = [];
	$drop_tables = [];
	$drop_exports = [];
	$drop_fac_sets = [];
	$drop_hit_map = [];

	foreach($selectedPairs as $pairLabel){
		$parts = explode('→',$pairLabel);
		if(count($parts)!=2) continue;
		$from = trim($parts[0]);
		$to = trim($parts[1]);
		if($from==='' || $to==='') continue;
		if(!isset($idxByShortLocal[$from]) || !isset($idxByShortLocal[$to])) continue;

		$pairKey = 'drop_'.safe_key($from.'_'.$to);
		$drop_pair_map[$pairKey] = ['label'=>$pairLabel,'from'=>$from,'to'=>$to];

		$web = [
			'pairLabel'=>$pairLabel,
			'from'=>$from,'to'=>$to,
			'months'=>$selMonthKeysOrdered,
			'monthLabels'=>$selMonthLabelsOrdered,
			'rows'=>[]
		];

		$exp = [];
		$expHeader = ['LGD Block Name','Health Facility Name','Session Site Name'];
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

		$facSet = [];
		$hitSet = [];
		$iFrom = $idxByShortLocal[$from];
		$iTo = $idxByShortLocal[$to];

		foreach($facFiltered as $fkey=>$fd){
			$cells = [];
			$sumA=0; $sumB=0;
			$anyHit=false;

			foreach($selMonthKeysOrdered as $mk){
				$A = (isset($fd['months'][$mk]) && isset($fd['months'][$mk]['vals'][$iFrom])) ? $fd['months'][$mk]['vals'][$iFrom] : null;
				$B = (isset($fd['months'][$mk]) && isset($fd['months'][$mk]['vals'][$iTo])) ? $fd['months'][$mk]['vals'][$iTo] : null;

				if($A!==null) $sumA += $A;
				if($B!==null) $sumB += $B;

				$cell = ['from'=>null,'to'=>null,'pct'=>null];
				if($A!==null && $B!==null && $A>0 && $B < $A){
					$drop = ($A-$B)/$A*100;
					if($dropMatch($drop)){
						$anyHit=true;
						$hitSet[$fkey][$mk]=true;
						$cell = ['from'=>$A,'to'=>$B,'pct'=>$drop];
					}
				}
				$cells[$mk] = $cell;
			}

			$all = ['from'=>null,'to'=>null,'pct'=>null];
			if($sumA>0 && $sumB < $sumA){
				$dropAll = ($sumA-$sumB)/$sumA*100;
				if($dropMatch($dropAll)){
					// NOTE: "All months" for Dropouts is based on each month individually,
					// not on totals. Totals are shown for reference only and do not affect inclusion/counting.
					$all = ['from'=>$sumA,'to'=>$sumB,'pct'=>$dropAll];
				}
			}
if($anyHit){
				$facSet[$fkey]=true;
				$web['rows'][$fkey]=[
					'block'=>display_block_label($fd['block']),
					'facility'=>$fd['facility'],
					'sessionsite'=>$fd['sessionsite'],
					'cells'=>$cells,
					'all'=>$all
				];

				$line = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
				foreach($selMonthKeysOrdered as $mk){
					$cell = $cells[$mk];
					$line[] = ($cell['from']===null?'':round($cell['from']));
					$line[] = ($cell['to']===null?'':round($cell['to']));
					$line[] = ($cell['pct']===null?'':round($cell['pct'],1).'%');
				}
				$line[] = ($all['from']===null?'':round($all['from']));
				$line[] = ($all['to']===null?'':round($all['to']));
				$line[] = ($all['pct']===null?'':round($all['pct'],1).'%');
				$exp[] = $line;
			}
		}

		$drop_tables[$pairKey] = $web;
		$drop_exports[$pairKey]= $exp;
		$drop_fac_sets[$pairKey]= $facSet;
		$drop_hit_map[$pairKey]= $hitSet;
	}

	$_SESSION['drop_pair_map'] = $drop_pair_map;
	$_SESSION['pink_dropout_hits'] = $drop_hit_map;

	/* Inconsistencies (existing) */
	$t5_sets=['p3gtp1'=>[],'opv3gtopv1'=>[]];
	$t5_p3gtp1=[['LGD Block Name','Health Facility Name','Session Site Name','Penta3 (total)','Penta1 (total)','% change']];
	$t5_opv3gtopv1=[['LGD Block Name','Health Facility Name','Session Site Name','OPV3 (total)','OPV1 (total)','% change']];

	foreach($facFiltered as $key=>$fd){
		$sumP1=0; $sumP3=0; $sumO1=0; $sumO3=0;
		foreach($fd['months'] as $mk=>$md){
			if($iP1!==null && isset($md['vals'][$iP1]) && $md['vals'][$iP1]!==null) $sumP1 += $md['vals'][$iP1];
			if($iP3!==null && isset($md['vals'][$iP3]) && $md['vals'][$iP3]!==null) $sumP3 += $md['vals'][$iP3];
			if($iO1!==null && isset($md['vals'][$iO1]) && $md['vals'][$iO1]!==null) $sumO1 += $md['vals'][$iO1];
			if($iO3!==null && isset($md['vals'][$iO3]) && $md['vals'][$iO3]!==null) $sumO3 += $md['vals'][$iO3];
		}

		if($iP1!==null && $iP3!==null && $sumP3 > $sumP1){
			$t5_sets['p3gtp1'][$key]=true;
			$pct = ($sumP1>0) ? (($sumP3-$sumP1)/$sumP1*100) : null;
			$t5_p3gtp1[] = [
				display_block_label($fd['block']),$fd['facility'],$fd['sessionsite'],
				round($sumP3), round($sumP1),
				($pct===null?'':('+'.round($pct,1).'%'))
			];
		}
		if($iO1!==null && $iO3!==null && $sumO3 > $sumO1){
			$t5_sets['opv3gtopv1'][$key]=true;
			$pct = ($sumO1>0) ? (($sumO3-$sumO1)/$sumO1*100) : null;
			$t5_opv3gtopv1[] = [
				display_block_label($fd['block']),$fd['facility'],$fd['sessionsite'],
				round($sumO3), round($sumO1),
				($pct===null?'':('+'.round($pct,1).'%'))
			];
		}
	}

	/* NEW: dynamic additional Inconsistencies pairs */
	$incons_pair_map = [];            // downloadKey => ['from'=>..,'to'=>..,'label'=>..,'pid'=>..]
	$incons_tables = [];              // pid => rows
	$incons_fac_sets = [];            // pid => facilitySet
	$incons_export_map = [];          // downloadKey => rows

	$existingPairSet = [];
	$existingPairSet['Penta1→Penta3'] = true; // maps to Penta3>Penta1
	$existingPairSet['OPV1→OPV3'] = true;     // maps to OPV3>OPV1

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
		$labelName = 'Inconsistencies — '.display_vax_label($to).'>'.display_vax_label($from);

		$tbl = [['LGD Block Name','Health Facility Name','Session Site Name', display_vax_label($to).' (total)', display_vax_label($from).' (total)', '% change']];
		$facSet = [];

		$iFrom = $idxByShortLocal[$from];
		$iTo = $idxByShortLocal[$to];

		foreach($facFiltered as $fkey=>$fd){
			$sumFrom = 0; $sumTo = 0;
			foreach($fd['months'] as $mk=>$md){
				if(isset($md['vals'][$iFrom]) && $md['vals'][$iFrom]!==null) $sumFrom += $md['vals'][$iFrom];
				if(isset($md['vals'][$iTo]) && $md['vals'][$iTo]!==null) $sumTo += $md['vals'][$iTo];
			}
			if($sumTo > $sumFrom){
				$facSet[$fkey] = true;
				$pct = ($sumFrom>0) ? (($sumTo-$sumFrom)/$sumFrom*100) : null;
				$tbl[] = [
					display_block_label($fd['block']),
					$fd['facility'],
					$fd['sessionsite'],
					round($sumTo),
					round($sumFrom),
					($pct===null?'':('+'.round($pct,1).'%'))
				];
			}
		}

		$incons_tables[$pid] = $tbl;
		$incons_fac_sets[$pid] = $facSet;
		$incons_export_map[$downloadKey] = $tbl;

		$incons_pair_map[$downloadKey] = [
			'from'=>$from,
			'to'=>$to,
			'label'=>$labelName,
			'pid'=>$pid
		];
	}

	$_SESSION['incons_pair_map'] = $incons_pair_map;

	/* Co-admin */
	$coSpecs = [
		'co1'=>['OPV1'=>$iO1,'Penta1'=>$iP1,'RVV1'=>$iRVV1,'PCV1'=>$iPCV1,'IPV1'=>$iIPV1],
		'co2'=>['OPV2'=>$iO2,'Penta2'=>$iP2,'RVV2'=>$iRVV2],
		'co3'=>['OPV3'=>$iO3,'Penta3'=>$iP3,'RVV3'=>$iRVV3,'PCV2'=>$iPCV2,'IPV2'=>$iIPV2],
		'co4'=>['MR1'=>$iMR1,'PCV Booster'=>$iPCVB,'IPV3'=>$iIPV3],
		'co5'=>['MR2'=>$iMR2,'DPT 1st Booster'=>$iDPTB],
	];

	$coTables = [];
	$coExports = [];
	$coFacilities = [];
	$coAnySets = [];
	$coAllSets = [];
	foreach($coSpecs as $coKey=>$spec){
		$vaxList = array_keys($spec);
		$web = ['key'=>$coKey, 'vaccines'=>$vaxList, 'months'=>$selMonthKeysOrdered, 'monthLabels'=>$selMonthLabelsOrdered, 'rows'=>[]];
		$exp = [];
		$expHeader = ['LGD Block Name','Health Facility Name','Session Site Name'];
		foreach($selMonthKeysOrdered as $mk){
			foreach($vaxList as $vx){ $expHeader[] = (isset($selMonthLabelsOrdered[$mk])?$selMonthLabelsOrdered[$mk]:$mk).' '.display_vax_label($vx); }
		}
		foreach($vaxList as $vx){ $expHeader[] = 'All months '.display_vax_label($vx); }
		$exp[] = $expHeader;

		$set = [];
		foreach($facFiltered as $fkey=>$fd){
			$rowVals = [];
			$totals = [];
			foreach($vaxList as $vx){ $totals[$vx]=0; }
			$viol = false; $monthViolCount = 0;

			foreach($selMonthKeysOrdered as $mk){
				$valsMonth = [];
				foreach($spec as $vx=>$idx){
					$val = null;
					if($idx!==null && isset($fd['months'][$mk]) && isset($fd['months'][$mk]['vals'][$idx])){ $val = $fd['months'][$mk]['vals'][$idx]; }
					$rowVals[$mk][$vx] = $val;
					if($val!==null) $totals[$vx] += $val;
					$valsMonth[$vx] = $val;
				}
				if(coadmin_has_highlighted_difference($valsMonth)) { $viol = true; $monthViolCount++; }
			}

			$valsTot = [];
			foreach($totals as $vx=>$tv){ $valsTot[$vx] = $tv; }
			if(coadmin_has_highlighted_difference($valsTot)) $viol = true;

			if($viol){
				$set[$fkey]=true;
				// Any month vs All months classification for this co-admin KPI
				if(!isset($coAnySets)) $coAnySets = [];
				if(!isset($coAllSets)) $coAllSets = [];
				$totalMonthsSel = count($selMonthKeysOrdered);
				if($totalMonthsSel>0 && $monthViolCount === $totalMonthsSel){
					$coAllSets[$coKey][$fkey]=true;
				} else {
					$coAnySets[$coKey][$fkey]=true;
				}
				$web['rows'][$fkey]=['block'=>display_block_label($fd['block']), 'facility'=>$fd['facility'], 'sessionsite'=>$fd['sessionsite'], 'vals'=>$rowVals, 'totals'=>$totals];
				$line = [display_block_label($fd['block']),$fd['facility'],$fd['sessionsite']];
				foreach($selMonthKeysOrdered as $mk){
					foreach($vaxList as $vx){
						$v = $rowVals[$mk][$vx];
						$line[] = ($v===null?'':round($v));
					}
				}
				foreach($vaxList as $vx){ $line[] = round($totals[$vx]); }
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
	$cT0 = $chartCounts($t0_facilities);
	$cT7 = $chartCounts($t7_facilities);
	$cT9 = $chartCounts($t9_facilities);
	$cT2 = $chartCounts($t2_facilities);
	$cS6 = $chartCounts($t6_facilities);
	$cT8 = $chartCounts($t8_facilities);
	$cT3 = $chartCounts($t3_facilities);
	$cI1 = $chartCounts($t5_sets['p3gtp1']);
	$cI2 = $chartCounts($t5_sets['opv3gtopv1']);

	$cInconsExtra = []; // pid => counts
	foreach($incons_fac_sets as $pid=>$set){ $cInconsExtra[$pid] = $chartCounts($set); }

	$cCo = [];
	foreach($coFacilities as $k=>$set){ $cCo[$k] = $chartCounts($set); }

	$cDrop = [];
	foreach($drop_fac_sets as $k=>$set){ $cDrop[$k] = $chartCounts($set); }

	/* KPI counts */
	$kpiCount = function($facSet, $anySet=null, $allSet=null){
		$any = ($anySet===null) ? count($facSet) : count($anySet);
		$all = ($allSet===null) ? 0 : count($allSet);
		return ['total'=>count($facSet),'any'=>$any,'all'=>$all];
	};

	$kpi = [
		't0' => $kpiCount($t0_facilities, $t0_any_facilities, $t0_all_facilities),
		't7' => $kpiCount($t7_facilities, isset($t7_any_facilities)?$t7_any_facilities:array_diff_key($t7_facilities, isset($t7_all_facilities)?$t7_all_facilities:[]), isset($t7_all_facilities)?$t7_all_facilities:[]),
		't9' => $kpiCount($t9_facilities, $t9_any_facilities, $t9_all_facilities),
		't2' => $kpiCount($t2_facilities, isset($t2_any_facilities)?$t2_any_facilities:array_diff_key($t2_facilities, isset($t2_all_facilities)?$t2_all_facilities:[]), isset($t2_all_facilities)?$t2_all_facilities:[]),
		't6' => $kpiCount($t6_facilities, isset($t6_any_facilities)?$t6_any_facilities:[], isset($t6_all_facilities)?$t6_all_facilities:[]),
		't8' => $kpiCount($t8_facilities, isset($t8_any_facilities)?$t8_any_facilities:[], isset($t8_all_facilities)?$t8_all_facilities:[]),
		't3' => $kpiCount($t3_facilities, isset($t3_any_facilities)?$t3_any_facilities:[], isset($t3_all_facilities)?$t3_all_facilities:[]),

		// Inconsistencies between doses (NO Any/All split requested)
		'i1' => $kpiCount($t5_sets['p3gtp1']),
		'i2' => $kpiCount($t5_sets['opv3gtopv1']),

		// Co-admin (Any/All split requested)
		'co1'=> $kpiCount($coFacilities['co1'], isset($coAnySets['co1'])?$coAnySets['co1']:[], isset($coAllSets['co1'])?$coAllSets['co1']:[]),
		'co2'=> $kpiCount($coFacilities['co2'], isset($coAnySets['co2'])?$coAnySets['co2']:[], isset($coAllSets['co2'])?$coAllSets['co2']:[]),
		'co3'=> $kpiCount($coFacilities['co3'], isset($coAnySets['co3'])?$coAnySets['co3']:[], isset($coAllSets['co3'])?$coAllSets['co3']:[]),
		'co4'=> $kpiCount($coFacilities['co4'], isset($coAnySets['co4'])?$coAnySets['co4']:[], isset($coAllSets['co4'])?$coAllSets['co4']:[]),
		'co5'=> $kpiCount($coFacilities['co5'], isset($coAnySets['co5'])?$coAnySets['co5']:[], isset($coAllSets['co5'])?$coAllSets['co5']:[]),
	];

	foreach($drop_fac_sets as $k=>$set){
		$anySet = [];
		$allSet = [];
		$totalMonthsSel = count($selMonthKeysOrdered);
		if(isset($drop_hit_map[$k])){
			foreach($drop_hit_map[$k] as $fkey=>$mm){
				$hitCount = 0;
				foreach($selMonthKeysOrdered as $mk){
					if(isset($mm[$mk])) $hitCount++;
				}
				if($hitCount > 0){
					if($totalMonthsSel>0 && $hitCount === $totalMonthsSel) $allSet[$fkey]=true;
					else $anySet[$fkey]=true;
				}
			}
		}
		$kpi[$k] = $kpiCount($set, $anySet, $allSet);
	}

	foreach($incons_fac_sets as $pid=>$set){ $kpi[$pid] = $kpiCount($set); }

	/* Summary tables (Indicator / Facilities / %) for each KPI) */
	$summaryByPid = [];
	/* CHANGED: denominator is session-site-wise (distinct Block+Facility+Session Site), matching session-site-wise KPIs */
	$summaryTotalDen = max(1, (int)$ssDen);

	$mkRow = function($name,$cnt) use ($summaryTotalDen){
		$cnt = (int)$cnt;
		$pct = ($summaryTotalDen>0) ? round(($cnt/$summaryTotalDen)*100, 2) : 0;
		return ['name'=>$name,'count'=>$cnt,'pct'=>$pct];
	};

	// Availability KPIs (single row)
	$summaryByPid['t0'] = ['any'=>[$mkRow('All Indicators having 0 values but not blank', (isset($kpi['t0']['any'])?$kpi['t0']['any']:0))], 'all'=>[$mkRow('All Indicators having 0 values but not blank', (isset($kpi['t0']['all'])?$kpi['t0']['all']:0))]];
	$summaryByPid['t7'] = ['any'=>[$mkRow('Indicators with repeating values', (isset($kpi['t7']['any'])?$kpi['t7']['any']:0))], 'all'=>[$mkRow('Indicators with repeating values', (isset($kpi['t7']['all'])?$kpi['t7']['all']:0))]];
	$summaryByPid['t9'] = ['any'=>[$mkRow('Zero coverage session', (isset($kpi['t9']['any'])?$kpi['t9']['any']:0))], 'all'=>[$mkRow('Zero coverage session', (isset($kpi['t9']['all'])?$kpi['t9']['all']:0))]];

	// Completeness summary per indicator
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
		$anyRows=[]; $allRows=[]; $overallRows=[];
		foreach($outAnyCounts as $vx=>$cnt){
			$allCnt = isset($outAllCounts[$vx]) ? (int)$outAllCounts[$vx] : 0;
			$overallCnt = (int)$cnt;
			$anyCnt = max(0, $overallCnt - $allCnt);
			$anyRows[] = $mkRow($vx,$anyCnt);
			$allRows[] = $mkRow($vx,$allCnt);
			$overallRows[] = $mkRow($vx,$overallCnt);
		}
		usort($anyRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		usort($allRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		usort($overallRows, function($a,$b){ return ($b['pct']<=>$a['pct']); });
		$summaryByPid['t3'] = ['overall'=>$overallRows];
	}

	// Planned but not held summary (single row)
	$summaryByPid['t6'] = ['any'=>[$mkRow('Planned but not held', (isset($kpi['t6']['any'])?$kpi['t6']['any']:0))], 'all'=>[$mkRow('Planned but not held', (isset($kpi['t6']['all'])?$kpi['t6']['all']:0))], 'overall'=>[$mkRow('Planned but not held', (isset($kpi['t6']['total'])?$kpi['t6']['total']:0))]];

	// Avg Beneficiaries per session < 5 summary (single row)
	$summaryByPid['t8'] = ['any'=>[$mkRow('Avg Beneficiaries per session < 5', (isset($kpi['t8']['any'])?$kpi['t8']['any']:0))], 'all'=>[$mkRow('Avg Beneficiaries per session < 5', (isset($kpi['t8']['all'])?$kpi['t8']['all']:0))], 'overall'=>[$mkRow('Avg Beneficiaries per session < 5', (isset($kpi['t8']['total'])?$kpi['t8']['total']:0))]];

	// Dropouts and Inconsistencies (single row per KPI)
	foreach($drop_fac_sets as $k=>$set){
		$pairName = isset($drop_pair_defs[$k]) ? $drop_pair_defs[$k]['pairLabel'] : $k;
		$summaryByPid[$k] = ['any'=>[$mkRow($pairName, isset($kpi[$k]['any'])?$kpi[$k]['any']:0)], 'all'=>[$mkRow($pairName, isset($kpi[$k]['all'])?$kpi[$k]['all']:0)], 'overall'=>[$mkRow($pairName, isset($kpi[$k]['total'])?$kpi[$k]['total']:0)]];
	}
	$summaryByPid['i1'] = ['any'=>[$mkRow('Penta3>Penta1', isset($kpi['i1']['total'])?$kpi['i1']['total']:0)], 'all'=>[]];
	$summaryByPid['i2'] = ['any'=>[$mkRow('OPV3>OPV1', isset($kpi['i2']['total'])?$kpi['i2']['total']:0)], 'all'=>[]];

	/* Cards list */
	$cardsList = [];
	$cardsList[] = ['id'=>'t0','name'=>'All Indicators having 0 values but not blank','stat'=>$kpi['t0'],'group'=>'availability','downloadKey'=>'t0'];
	$cardsList[] = ['id'=>'t7','name'=>'All Indicators with same values','stat'=>$kpi['t7'],'group'=>'availability','downloadKey'=>'t7'];
	$cardsList[] = ['id'=>'t9','name'=>'Zero coverage session','stat'=>$kpi['t9'],'group'=>'availability','downloadKey'=>'t9'];
	$cardsList[] = ['id'=>'t2','name'=>'Key Missing Indicators','stat'=>$kpi['t2'],'group'=>'completeness','downloadKey'=>'t2'];
	$cardsList[] = ['id'=>'t6','name'=>'Planned but not held','stat'=>$kpi['t6'],'group'=>'accuracy','downloadKey'=>'t6'];
	$cardsList[] = ['id'=>'t8','name'=>'Avg Beneficiaries per session < 5','stat'=>$kpi['t8'],'group'=>'accuracy','downloadKey'=>'t8'];
	$cardsList[] = ['id'=>'t3','name'=>'Outliers','stat'=>$kpi['t3'],'group'=>'accuracy','downloadKey'=>'t3'];

	foreach($drop_pair_map as $dk=>$pm){
		$cardsList[] = ['id'=>$dk,'name'=>'Dropouts — '.$pm['label'],'stat'=>$kpi[$dk],'group'=>'accuracy','downloadKey'=>$dk];
	}

    
	$cardsList[] = ['id'=>'i1','name'=>'Inconsistencies — Penta3>Penta1','stat'=>$kpi['i1'],'group'=>'consistency','downloadKey'=>'t5_p3gtp1'];
	$cardsList[] = ['id'=>'i2','name'=>'Inconsistencies — OPV3>OPV1','stat'=>$kpi['i2'],'group'=>'consistency','downloadKey'=>'t5_opv3gtopv1'];

	/* NEW: add dynamic inconsistencies KPI cards */
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
		't0'=>['labels'=>array_keys($cT0),'values'=>array_values($cT0),'color'=>$groupColor['availability']],
		't7'=>['labels'=>array_keys($cT7),'values'=>array_values($cT7),'color'=>$groupColor['availability']],
		't9'=>['labels'=>array_keys($cT9),'values'=>array_values($cT9),'color'=>$groupColor['availability']],
		't2'=>['labels'=>array_keys($cT2),'values'=>array_values($cT2),'color'=>$groupColor['completeness']],
		't6'=>['labels'=>array_keys($cS6),'values'=>array_values($cS6),'color'=>$groupColor['accuracy']],
		't8'=>['labels'=>array_keys($cT8),'values'=>array_values($cT8),'color'=>$groupColor['accuracy']],
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
	$_SESSION['exports'] = [];
	$_SESSION['exports']['t0'] = ['label'=>'Indicators_0_not_blank_matrix','rows'=>$t0];
	$_SESSION['exports']['t7'] = ['label'=>'Indicators_with_same_values','rows'=>$t7];
	$_SESSION['exports']['t9'] = ['label'=>'Zero_coverage_session','rows'=>$t9];
	$_SESSION['exports']['t2'] = ['label'=>'Missing_Indicator_matrix','rows'=>$t2];
	$_SESSION['exports']['t6'] = ['label'=>'Planned_but_not_held','rows'=>$t6_export];
	$_SESSION['exports']['t8'] = ['label'=>'Avg_Beneficiaries_per_session_lt_5','rows'=>$t8_export];
	$_SESSION['exports']['t3'] = ['label'=>'Outliers_matrix','rows'=>$t3_export];
	$_SESSION['exports']['t5_p3gtp1'] = ['label'=>'Inconsistencies_Penta3_gt_Penta1','rows'=>$t5_p3gtp1];
	$_SESSION['exports']['t5_opv3gtopv1'] = ['label'=>'Inconsistencies_OPV3_gt_OPV1','rows'=>$t5_opv3gtopv1];

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
		't0' => array_keys($t0_facilities),
		't7' => array_keys($t7_facilities),
		't9' => array_keys($t9_facilities),
		't2' => array_keys($t2_facilities),
		't6' => array_keys($t6_facilities),
		't8' => array_keys($t8_facilities),
		't3' => array_keys($t3_facilities),
		't5_p3gtp1'=> array_keys($t5_sets['p3gtp1']),
		't5_opv3gtopv1'=> array_keys($t5_sets['opv3gtopv1']),
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

	$t2_web = [
		'title' => $t2Title,
		'vaccines' => $selVaxList,
		'months' => $selMonthKeysOrdered,
		'monthLabels' => $selMonthLabelsOrdered,
		'rows' => $t2_matrix_cache,
		'highlightN' => true
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
					<a class="btn" href="<?=h($BASE_URL)?>?<?=h($ACCESS_QS)?>&download_pink=<?=h($dlKey)?>">Actual data with highlighted cells</a>
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
							render_table($t0, true);
						} elseif($pid==='t7'){
							render_table($t7, true);
						} elseif($pid==='t9'){
							render_table($t9, true);
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
							render_table($t5_opv3gtopv1, false);
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
							echo '<table class="dataTable"><thead><tr><th>Indicator</th><th>Session Sites</th><th>%</th></tr></thead><tbody>';
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
		$cardHtml .= '<h3>'.h($c['name']).'</h3>';
		$showSplit = (isset($c['stat']['any']) && isset($c['stat']['all']) && (
			$grp==='availability' || $pid==='t2' || $pid==='t6' || $pid==='t8' || str_starts_with($pid,'drop_') || str_starts_with($pid,'co')
		));

		if($showSplit){
			$anyCnt = (int)$c['stat']['any'];
			$allCnt = (int)$c['stat']['all'];
			$cardHtml .= '<div class="splitTotal"><span class="splitTotalNum">'.h((string)$totalVal).'</span><span class="unit"> session sites</span></div>';
			$cardHtml .= '<div class="split"><div class="splitCol"><div class="splitLbl">Any month</div><div class="splitVal"><span class="splitValNum">'.h((string)$anyCnt).'</span><span class="unit"> session sites</span></div></div><div class="splitCol"><div class="splitLbl">All months</div><div class="splitVal"><span class="splitValNum">'.h((string)$allCnt).'</span><span class="unit"> session sites</span></div></div></div>';

			// add top-3 lists for Completeness and Outliers (kept as-is)
			if($pid==='t2'){
				$cardHtml .= '<div class="top3"><div class="top3Row"><b>Any month:</b> '.h(implode(', ', $top3BlankAny)).'</div><div class="top3Row"><b>All months:</b> '.h(implode(', ', $top3BlankAll)).'</div><div class="top3Row"><b>Overall:</b> '.h(implode(', ', $top3BlankOverall)).'</div></div>';
			}
			if($pid==='t3'){
				$cardHtml .= '<div class="top3"><div class="top3Row">'.h(!empty($top3OutOverall)?implode(', ', $top3OutOverall):'-').'</div></div>';
			}
		} else {
			// Single-number KPI card (no "facilities" text)
			$cardHtml .= '<div class="num">'.h((string)$totalVal).' <span class="unit">session sites</span></div>';
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

	/* -------------------- Overall Score data -------------------- */
	/* CHANGED: denominator is session-site-wise (distinct Block+Facility+Session Site), matching session-site-wise KPIs */
	$osDen = (int)$ssDen;
	$osComponents = [
		'availability'=>['name'=>'Availability','kpis'=>[]],
'accuracy'=>['name'=>'Accuracy','kpis'=>[]],
		'consistency'=>['name'=>'Consistency','kpis'=>[]],
	];

	foreach($cardsList as $c){
		$g = $c['group'];
		if(!isset($osComponents[$g])) continue;
		$stat = isset($c['stat']) ? $c['stat'] : ['total'=>0,'any'=>0,'all'=>0];
		$tot = isset($stat['total']) ? (int)$stat['total'] : 0;
		$any = isset($stat['any']) ? (int)$stat['any'] : $tot;
		$all = isset($stat['all']) ? (int)$stat['all'] : 0;
		$pct = ($osDen>0) ? ($tot*100.0/$osDen) : 0.0;
		$pctAny = ($osDen>0) ? ($any*100.0/$osDen) : 0.0;
		$pctAll = ($osDen>0) ? ($all*100.0/$osDen) : 0.0;

		$osComponents[$g]['kpis'][] = [
			'name'=>$c['name'],
			'total'=>$tot,
			'any'=>$any,
			'all'=>$all,
			'pct'=>$pct,
			'pctAny'=>$pctAny,
			'pctAll'=>$pctAll
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
		$score = max(0.0, 100.0 - $maxTot); // conservative score based on worst KPI %
		$osScores[$gid] = $score;

		$osComponents[$gid]['top'] = $top;
		$osComponents[$gid]['maxAny'] = $maxAny;
		$osComponents[$gid]['maxAll'] = $maxAll;
		$osComponents[$gid]['score'] = $score;

		$osMini[] = ['id'=>$gid,'name'=>$g['name'],'score'=>$score,'maxTot'=>$maxTot];
	}

	$overallScore = 0.0;
	if(count($osScores)>0){
		$sum = 0.0; $n = 0;
		foreach($osScores as $s){ $sum += (float)$s; $n++; }
		$overallScore = ($n>0) ? ($sum/$n) : 0.0;
	}

	$overallSummaryHtml = '';
	$overallSummaryHtml .= '<div id="osOverlay" aria-hidden="true">';
	$overallSummaryHtml .=   '<div class="osTopbar"><div class="osWrap"><div class="osTopbarInner">';
	$overallSummaryHtml .=     '<div><div class="osTitle">Overall Score</div><div class="osMeta">'.h($stateName).' · '.h($distName).' · '.h(strip_tags($durationStrHtml)).'</div></div>';
	$overallSummaryHtml .=     '<div class="osBack"><button type="button" class="btn" id="osWordBtn">Download Word</button><button type="button" class="btn" id="osBackBtn">Back</button></div>';
	$overallSummaryHtml .=   '</div></div></div>';

	$overallSummaryHtml .=   '<div class="osWrap">';
	$overallSummaryHtml .=     '<div class="osGrid3">';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Coverage</div><div class="k">'.h((string)$globalBlocksCount).'</div><div class="s">blocks</div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Session Sites</div><div class="k">'.h((string)$osDen).' <span class="sm">session sites</span></div></div>';
	$overallSummaryHtml .=       '<div class="osCard"><div class="t">Period</div><div class="k">'.h((string)count($monthKeys)).'</div><div class="s">months analysed</div></div>';
	$overallSummaryHtml .=     '</div>';

	$overallSummaryHtml .=     '<div class="osHero">';
	$overallSummaryHtml .=       '<div class="osScore">';
	$overallSummaryHtml .=         '<div class="osScoreRing"><canvas id="osScoreRing"></canvas><div class="osScoreText"><div class="n" id="osScoreNum">'.h((string)round($overallScore)).'</div><div class="l">Overall score (0–100)</div></div></div>';
	$overallSummaryHtml .=         '<div class="osScoreNote">Denominator: '.h((string)$osDen).' session sites under current selection.<br>Method: Component score = 100 − (worst KPI %); Overall score = average of the 3 component scores.</div>';
	$overallSummaryHtml .=       '</div>';
	$overallSummaryHtml .=       '<div class="osMiniGrid" id="osComponentMini">';
	foreach($osMini as $mi){
		$overallSummaryHtml .= '<div class="osMini"><div class="h">'.h($mi['name']).'</div><div class="row"><div class="pct">'.h((string)round($mi['score'])).'</div><div class="sub">score</div></div><div class="sub">Worst KPI: '.h(number_format((float)$mi['maxTot'],1)).'%</div></div>';
	}
	$overallSummaryHtml .=       '</div>';
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
		$overallSummaryHtml .=       '<div class="osTableWrap"><table class="osTbl" id="osTbl_'.h($gid).'"><thead><tr><th>KPI</th><th>Session Sites</th><th>%</th></tr></thead><tbody>';
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

	$overallSummaryHtml .=     '<div class="osFoot">Tip: Percentages use denominator of total session sites under current selection.</div>';
	$overallSummaryHtml .=   '</div>';
	$overallSummaryHtml .= '</div>';

	$osData = ['overallScore'=>$overallScore,'components'=>$osComponents];
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
			<button class="btn btnDisabled" id="btnPdf" disabled>Download to PDF</button>
			<button type="button" onclick="window.location.href='https://datamgmt.in/dqa.php';">Main Page</button>
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
		</div>
		<div class="infoBox">
			<div class="statTitle">Number of session sites</div>
			<div class="statValue"><?= (int)$ssDen ?></div>
		</div>
	</div>

	<div class="componentsBox">
		<div class="componentsLabelBox"><div class="componentsLabelText">Components of Data Quality</div></div>
		<div class="groupRow">
			<div class="groupCol">
				<button type="button" class="groupBtn availability" data-group="availability" title="All reports for the study period must be available in the portal at the time of assessment">Availability</button>
				<ul class="kpiBullets">					<li>All Indicators having 0 values but not blank</li>
					<li>All Indicators with same values</li>
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
					<li>Inconsistencies — OPV3&gt;OPV1</li>
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
			<input type="hidden" name="active_group" id="activeGroupInput" value="<?=h($initGroup)?>">

			<div class="filtersBox" id="filtersBoxSingle">
				<div class="filtersBoxTitle">Filters</div>

				<div class="filterRow">
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
											<?php $chk = (empty($filters['outliers_vax']) || in_array($vx,$filters['outliers_vax'],true))?'checked':''; ?>
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
										<?php $incOpts=[['INC_LOW','25–50.49 Low'],['INC_MOD','50.50–100 Moderate'],['INC_EXT','>100 Extreme']]; foreach($incOpts as $opt): $chk = (in_array($opt[0], (array)$filters['outliers_inc'], true)) ? 'checked' : ''; ?>
											<label class="chk"><input type="checkbox" name="outliers_inc[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

									<input type="hidden" name="outliers_drop_present" value="1">
									<div class="small" style="margin-top:6px"><b>Drop buckets</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="outliers_drop[]"> Select All</label>
									<div class="chkWrap">
										<?php $dropOpts=[['DROP_LOW','−25 to −50.49 Low'],['DROP_MOD','−50.50 to −100 Moderate'],['DROP_EXT','<−100 Extreme']]; foreach($dropOpts as $opt): $chk = (in_array($opt[0], (array)$filters['outliers_drop'], true)) ? 'checked' : ''; ?>
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
										<?php $drOpts=[ ['R5_10','5–10.99% (Low)'], ['R11_20','11–19.99% (Moderate)'], ['R20P','>=20% (Extreme)'] ]; foreach($drOpts as $opt): $chk = (empty($filters['drop_ranges']) || in_array($opt[0],$filters['drop_ranges'],true))?'checked':''; ?>
											<label class="chk"><input type="checkbox" name="drop_ranges[]" value="<?=h($opt[0])?>" <?=$chk?>> <?=h($opt[1])?></label>
										<?php endforeach; ?>
									</div>

									<div class="small" style="margin-top:8px"><b>Pairs</b></div>
									<label class="chk"><input type="checkbox" data-role="selectall" data-target="drop_pairs[]"> Select All</label>
									<div class="chkWrap">
										<?php foreach($PAIR_DEFAULTS as $pr): ?>
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
					<div class="filterGroup" additionalFilterGroup">
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
	// Hide the entire 'Additional Filter' dropdown for Availability or Consistency group
	addFilterGroups.forEach(el=>{ el.style.display = (isAvail || isCons) ? 'none' : ''; });
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
		var score = Math.max(0, Math.min(100, Math.round(data.overallScore||0)));
		var ctx = document.getElementById('osScoreRing');
		if(ctx && !ctx.__chart){
			ctx.__chart = new Chart(ctx.getContext('2d'), {
				type:'doughnut',
				data:{ labels:['Score',''], datasets:[{ data:[score, 100-score], borderWidth:0 }] },
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
		meta = meta.replace(/(\b(?:State|District|Duration|Months|Blocks)\b)\s*:\s*/g, '$1: ');

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
		var cards = document.querySelectorAll('#osOverlay .osGrid4 .osCard, #osOverlay .osGrid3 .osCard');
		html += '<table class="tbl" style="margin-bottom:12pt;"><tr>';
		for(var ci=0; ci<cards.length; ci++){
			var c = cards[ci];
			var t = c.querySelector('.t');
			var k = c.querySelector('.k');
			var s = c.querySelector('.s');
			var m = c.querySelector('.m');
			html += '<td style="width:33.33%;padding:0;border:0;">';
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
			html += '<thead><tr><th style="width:64%;">KPI</th><th style="width:18%;">Session Sites</th><th style="width:18%;">%</th></tr></thead><tbody>';
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
</body>
</html>
<?php
}

