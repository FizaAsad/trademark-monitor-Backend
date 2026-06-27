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
// 1.0 = identical, 0.0 = completely different
function getSimilarity(a, b) {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein.get(s1, s2);
  return 1 - distance / maxLen;
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

// ── Search EUIPO via TMview public API (no key needed) ───────────────────────
// TMview is the official multi-office search portal backed by EUIPO.
// This endpoint is public and returns JSON directly.
async function searchEUIPO(keyword) {
  const url = "https://www.tmdn.org/tmview/api/trademark/search";

  const payload = {
    basicSearch: keyword,
    offices: ["EM"],   // EM = European Union (EUIPO)
    pageSize: 20,
    pageNumber: 1,
  };

  const response = await axios.post(url, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    },
    timeout: 15000,
  });

  // TMview returns results inside response.data.trademarks
  return response.data?.trademarks || [];
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
  await supabase.from("trademark_matches").insert([
    {
      registry: "EUIPO",
      filing_name: filing.name,
      filing_date: filing.filingDate || null,
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
        // Step 3: Search EUIPO via TMview
        const results = await searchEUIPO(kw.term);
        console.log(`[EUIPO] Got ${results.length} result(s) for "${kw.term}"`);

        // Step 4: Compare each result with Levenshtein
        for (const filing of results) {
          const filingName = filing.name || filing.trademarkName || "";
          if (!filingName) continue;

          const score = getSimilarity(kw.term, filingName);

          // Step 5: Only process matches above 0.8 similarity
          if (score >= 0.8) {
            console.log(
              `[EUIPO] Match found: "${filingName}" (score: ${score.toFixed(2)})`
            );

            // Step 6: Dedup check before inserting
            const duplicate = await isDuplicate(filingName, kw.term);
            if (duplicate) {
              console.log(`[EUIPO] Skipping duplicate: "${filingName}"`);
              continue;
            }

            // Step 7: Insert into trademark_matches
            await insertMatch(filing, kw.term, score);
            totalInserted++;
            console.log(`[EUIPO] Inserted: "${filingName}"`);
          }
        }
      } catch (kwErr) {
        // One keyword failing should NOT stop the others
        console.error(`[EUIPO] Error scanning keyword "${kw.term}":`, kwErr.message);
        errorMsg = kwErr.message;
      }

      // Step 8: Wait 2 seconds before next keyword (be polite to the server)
      await sleep(2000);
    }
  } catch (err) {
    // Top level failure
    console.error("[EUIPO] Scraper failed:", err.message);
    errorMsg = err.message;
  }

  // Step 9: Log the completed scan to scan_logs
  await logScan(startedAt, totalInserted, errorMsg);
  console.log(
    `[EUIPO] Scraper finished. Inserted ${totalInserted} new match(es).`
  );
}

module.exports = { runEUIPOScraper };