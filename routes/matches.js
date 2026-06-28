const express = require("express");
const router = express.Router();
const supabase = require("../lib/supabase");

// GET /api/matches
// Queries all 4 match tables and returns combined, sorted by created_at desc
router.get("/", async (req, res) => {
  try {
    const [trademark, domain, marketplace, social] = await Promise.all([
  supabase
    .from("trademark_matches")
    .select("id, registry, matched_keyword, filing_name, created_at, status")
    .order("created_at", { ascending: false }),

  supabase
    .from("domain_matches")
    .select("id, keyword_matched, domain, created_at, status")
    .order("created_at", { ascending: false }),

  supabase
    .from("marketplace_matches")
    .select("id, platform, keyword_matched, listing_title, created_at, status")
    .order("created_at", { ascending: false }),

  supabase
    .from("social_matches")
    .select("id, platform, keyword_matched, handle_or_url, created_at, status")
    .order("created_at", { ascending: false }),
]);

    // Check for errors on any table
    if (trademark.error) throw new Error("trademark_matches: " + trademark.error.message);
    if (domain.error)    throw new Error("domain_matches: "    + domain.error.message);
    if (marketplace.error) throw new Error("marketplace_matches: " + marketplace.error.message);
    if (social.error)    throw new Error("social_matches: "    + social.error.message);

    // Normalize each result into a common shape
        const trademarkRows = (trademark.data || []).map((r) => ({
      id:         r.id,
      source:     r.registry || "Trademark",
      category:   "trademark",
      keyword:    r.matched_keyword,
      match_name: r.filing_name,
      date_found: r.created_at,
      status:     r.status || "new",
    }));

        const domainRows = (domain.data || []).map((r) => ({
      id:         r.id,
      source:     "Domain",
      category:   "domain",
      keyword:    r.keyword_matched,
      match_name: r.domain,
      date_found: r.created_at,
      status:     r.status || "new",
    }));

    const marketplaceRows = (marketplace.data || []).map((r) => ({
      id:         r.id,
      source:     r.platform || "Marketplace",
      category:   "marketplace",
      keyword:    r.keyword_matched,
      match_name: r.listing_title,
      date_found: r.created_at,
      status:     r.status || "new",
    }));

    const socialRows = (social.data || []).map((r) => ({
      id:         r.id,
      source:     r.platform || "Social",
      category:   "social",
      keyword:    r.keyword_matched,
      match_name: r.handle_or_url,
      date_found: r.created_at,
      status:     r.status || "new",
    }));

    // Merge all and sort by date descending
    const all = [
      ...trademarkRows,
      ...domainRows,
      ...marketplaceRows,
      ...socialRows,
    ].sort((a, b) => new Date(b.date_found) - new Date(a.date_found));

    res.json(all);
  } catch (err) {
    console.error("[GET /api/matches] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/matches/:category/:id
// Updates the status of a match (new / reviewed / dismissed)
router.patch("/:category/:id", async (req, res) => {
  const { category, id } = req.params;
  const { status } = req.body;

  const tableMap = {
    trademark:   "trademark_matches",
    domain:      "domain_matches",
    marketplace: "marketplace_matches",
    social:      "social_matches",
  };

  const table = tableMap[category];
  if (!table) return res.status(400).json({ error: "Invalid category" });

  try {
    const { data, error } = await supabase
      .from(table)
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    console.error("[PATCH /api/matches] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;