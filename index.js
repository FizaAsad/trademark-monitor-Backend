require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS and JSON must come FIRST before any routes
app.use(cors({
  origin: ["http://localhost:3000", process.env.FRONTEND_URL].filter(Boolean),
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/keywords', require('./routes/keywords'));
app.use('/api/matches', require('./routes/matches'));

// Test endpoints
const { runEUIPOScraper } = require("./scrapers/euipoScraper");
app.get("/api/test-euipo", async (req, res) => {
  await runEUIPOScraper();
  res.json({ message: "EUIPO scan complete. Check trademark_matches in Supabase." });
});

// USPTO scraper -- disabled until Hassan fixes the puppeteer ESM issue
// const { runUSPTOScraper } = require("./scrapers/usptoScraper");
// app.get("/api/test-uspto", async (req, res) => {
//   const total = await runUSPTOScraper();
//   res.json({ message: `USPTO scan complete. ${total} new match(es) found.` });
// });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
const { runUKIPOScraper } = require("./scrapers/ukipoScraper");
app.get("/api/test-ukipo", async (req, res) => {
  const total = await runUKIPOScraper();
  res.json({ message: `UKIPO scan complete. ${total} new match(es) found.` });
});

const { runCIPOScraper } = require("./scrapers/cipoScraper");
app.get("/api/test-cipo", async (req, res) => {
  const total = await runCIPOScraper();
  res.json({ message: `CIPO scan complete. ${total} new match(es) found.` });
});