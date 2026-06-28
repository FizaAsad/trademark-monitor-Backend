const axios = require("axios");
const levenshtein = require("fast-levenshtein");
const supabase = require("../lib/supabase");

// ── Helper: similarity score between 0 and 1 ────────────────────────────────
function getSimilarity(a, b) {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein.get(s1, s2);
  return 1 - distance / maxLen;
}

// ── Helper: check if keyword is contained inside filing name ─────────────────
function isContainedMatch(keyword, filingName) {
  const k = keyword.toLowerCase().trim();
  const f = filingName.toLowerCase().trim();
  return f.includes(k) || k.includes(f);
}

// ── Helper: 2 second delay ───────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helper: log scan to scan_logs ────────────────────────────────────────────
async function logScan(startedAt, totalFound, errorMsg = null) {
  await supabase.from("scan_logs").insert([
    {
      scan_type: "trademark_ukipo",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      total_found: totalFound,
      error_log: errorMsg,
    },
  ]);
}

// ── Search UKIPO (mock — live site blocks server requests) ───────────────────
// TODO: replace with live scrape when accessible
// Live URL: https://trademarks.ipo.gov.uk/ipo-tmtext
async function searchUKIPO(keyword) {
  const mockResults = [
    { name: keyword,              filingDate: "2019-03-12", owner: "Mock Owner UK 1" },
    { name: keyword + " UK",      filingDate: "2020-07-22", owner: "Mock Owner UK 2" },
    { name: keyword + "S",        filingDate: "2018-11-30", owner: "Mock Owner UK 3" },
    { name: keyword.slice(0, -1), filingDate: "2021-01-05", owner: "Mock Owner UK 4" },
  ];
  return mockResults;
}

// ── Dedup check ──────────────────────────────────────────────────────────────
async function isDuplicate(filingName, matchedKeyword) {
  const { data } = await supabase
    .from("trademark_matches")
    .select("id")
    .eq("registry", "UKIPO")
    .eq("filing_name", filingName)
    .eq("matched_keyword", matchedKeyword)
    .limit(1);
  return data && data.length > 0;
}

// ── Insert match ─────────────────────────────────────────────────────────────
async function insertMatch(filing, keyword, score) {
  await supabase.from("trademark_matches").insert([
    {
      registry:         "UKIPO",
      filing_name:      filing.name,
      filing_date:      filing.filingDate || null,
      matched_keyword:  keyword,
      similarity_score: score,
      raw_data:         filing,
      status:           "new",
    },
  ]);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function runUKIPOScraper() {
  const startedAt = new Date().toISOString();
  let totalInserted = 0;
  let errorMsg = null;

  console.log("[UKIPO] Scraper started at", startedAt);

  try {
    const { data: keywords, error: kwError } = await supabase
      .from("keywords")
      .select("*")
      .eq("active", true);

    if (kwError) throw new Error("Failed to fetch keywords: " + kwError.message);
    if (!keywords || keywords.length === 0) {
      console.log("[UKIPO] No active keywords found. Exiting.");
      await logScan(startedAt, 0, "No active keywords");
      return 0;
    }

    console.log(`[UKIPO] Found ${keywords.length} active keyword(s) to scan.`);

    for (const kw of keywords) {
      console.log(`[UKIPO] Searching for: "${kw.term}"`);

      try {
        const results = await searchUKIPO(kw.term);
        console.log(`[UKIPO] Got ${results.length} result(s) for "${kw.term}"`);

        for (const filing of results) {
          const filingName = filing.name || "";
          if (!filingName) continue;

          const score = getSimilarity(kw.term, filingName);
          const contained = isContainedMatch(kw.term, filingName);

          if (score >= 0.8 || contained) {
            const finalScore = score >= 0.8 ? score : 0.75;
            console.log(`[UKIPO] Match found: "${filingName}" (score: ${finalScore.toFixed(2)})`);

            const duplicate = await isDuplicate(filingName, kw.term);
            if (duplicate) {
              console.log(`[UKIPO] Skipping duplicate: "${filingName}"`);
              continue;
            }

            await insertMatch(filing, kw.term, finalScore);
            totalInserted++;
            console.log(`[UKIPO] Inserted: "${filingName}"`);
          }
        }
      } catch (kwErr) {
        console.error(`[UKIPO] Error scanning keyword "${kw.term}":`, kwErr.message);
        errorMsg = kwErr.message;
      }

      await sleep(2000);
    }
  } catch (err) {
    console.error("[UKIPO] Scraper failed:", err.message);
    errorMsg = err.message;
  }

  await logScan(startedAt, totalInserted, errorMsg);
  console.log(`[UKIPO] Scraper finished. Inserted ${totalInserted} new match(es).`);
  return totalInserted;
}

module.exports = { runUKIPOScraper };