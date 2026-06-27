const axios = require("axios");
const levenshtein = require("fast-levenshtein");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    realtime: {
      transport: ws,
    },
  }
);

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

// ── Helper: also check if keyword is contained inside the filing name ────────
// e.g. keyword "Nike" inside filing "Nike International Ltd" = strong match
function isContainedMatch(keyword, filingName) {
  const k = keyword.toLowerCase().trim();
  const f = filingName.toLowerCase().trim();
  return f.includes(k) || k.includes(f);
}

// ── Helper: 2 second delay between requests ──────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Helper: log scan result to scan_logs table ───────────────────────────────
async function logScan(startedAt, totalFound, errorMsg = null) {
  await supabase.from("scan_logs").insert([
    {
      scan_type: "trademark_euipo",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      total_found: totalFound,
      error_log: errorMsg,
    },
  ]);
}

// ── Search EUIPO via eSearch API ─────────────────────────────────────────────
async function searchEUIPO(keyword) {
  // Mock data simulating EUIPO results — replace with live API when credentials available
  const mockResults = [
    { name: keyword, filingDate: "2020-01-15", owner: "Mock Owner EU 1" },
    { name: keyword + " EU", filingDate: "2019-06-20", owner: "Mock Owner EU 2" },
    { name: keyword + "S", filingDate: "2021-03-10", owner: "Mock Owner EU 3" },
    { name: keyword.slice(0, -1), filingDate: "2018-11-05", owner: "Mock Owner EU 4" },
  ];
  return mockResults;
}

// ── Check if this match already exists in DB (dedup) ────────────────────────
async function isDuplicate(filingName, matchedKeyword) {
  const { data } = await supabase
    .from("trademark_matches")
    .select("id")
    .eq("registry", "EUIPO")
    .eq("filing_name", filingName)
    .eq("matched_keyword", matchedKeyword)
    .limit(1);

  return data && data.length > 0;
}

// ── Insert a match into trademark_matches ────────────────────────────────────
async function insertMatch(filing, keyword, score) {
  const filingName = filing.name || filing.trademarkName || "";
  const filingDate = filing.filingDate || filing.applicationDate || null;

  await supabase.from("trademark_matches").insert([
    {
      registry: "EUIPO",
      filing_name: filingName,
      filing_date: filingDate,
      matched_keyword: keyword,
      similarity_score: score,
      raw_data: filing,
      status: "new",
    },
  ]);
}

// ── MAIN SCRAPER FUNCTION ────────────────────────────────────────────────────
async function runEUIPOScraper() {
  const startedAt = new Date().toISOString();
  let totalInserted = 0;
  let errorMsg = null;

  console.log("[EUIPO] Scraper started at", startedAt);

  try {
    // Step 1: Fetch all active keywords from Supabase
    const { data: keywords, error: kwError } = await supabase
      .from("keywords")
      .select("*")
      .eq("active", true);

    if (kwError) throw new Error("Failed to fetch keywords: " + kwError.message);
    if (!keywords || keywords.length === 0) {
      console.log("[EUIPO] No active keywords found. Exiting.");
      await logScan(startedAt, 0, "No active keywords");
      return;
    }

    console.log(`[EUIPO] Found ${keywords.length} active keyword(s) to scan.`);

    // Step 2: Loop through each keyword
    for (const kw of keywords) {
      console.log(`[EUIPO] Searching for: "${kw.term}"`);

      try {
        // Step 3: Search EUIPO
        const results = await searchEUIPO(kw.term);
        console.log(`[EUIPO] Got ${results.length} result(s) for "${kw.term}"`);

        // Step 4: Compare each result
        for (const filing of results) {
          const filingName = filing.name || filing.trademarkName || "";
          if (!filingName) continue;

          const score = getSimilarity(kw.term, filingName);
          const contained = isContainedMatch(kw.term, filingName);

          // Step 5: Flag if similarity > 0.8 OR keyword is contained in filing name
          if (score >= 0.8 || contained) {
            const finalScore = score >= 0.8 ? score : 0.75;
            console.log(
              `[EUIPO] Match found: "${filingName}" (score: ${finalScore.toFixed(2)})`
            );

            // Step 6: Dedup check
            const duplicate = await isDuplicate(filingName, kw.term);
            if (duplicate) {
              console.log(`[EUIPO] Skipping duplicate: "${filingName}"`);
              continue;
            }

            // Step 7: Insert into trademark_matches
            await insertMatch(filing, kw.term, finalScore);
            totalInserted++;
            console.log(`[EUIPO] Inserted: "${filingName}"`);
          }
        }
      } catch (kwErr) {
        console.error(`[EUIPO] Error scanning keyword "${kw.term}":`, kwErr.message);
        errorMsg = kwErr.message;
      }

      // Step 8: 2 second delay between keywords
      await sleep(2000);
    }
  } catch (err) {
    console.error("[EUIPO] Scraper failed:", err.message);
    errorMsg = err.message;
  }

  // Step 9: Log completed scan
  await logScan(startedAt, totalInserted, errorMsg);
  console.log(`[EUIPO] Scraper finished. Inserted ${totalInserted} new match(es).`);
}

module.exports = { runEUIPOScraper };