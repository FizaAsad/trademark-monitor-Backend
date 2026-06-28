require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
}));
app.use(express.json());

// Health check — keeps Render from sleeping
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/keywords', require('./routes/keywords'));
// app.use('/api/matches', require('./routes/matches'));
// app.use('/api/scan', require('./routes/scan'));
// app.use('/api/reports', require('./routes/reports'));
// app.use('/api/settings', require('./routes/settings'));

const { runEUIPOScraper } = require("./scrapers/euipoScraper");
app.get("/api/test-euipo", async (req, res) => {
  await runEUIPOScraper();
  res.json({ message: "EUIPO scan complete. Check trademark_matches in Supabase." });
});

const { runUSPTOScraper } = require("./scrapers/usptoScraper");
app.get("/api/test-uspto", async (req, res) => {
  const total = await runUSPTOScraper();
  res.json({ message: `USPTO scan complete. ${total} new match(es) found.` });
});

const { runIPAustraliaScraper } = require("./scrapers/ipAustraliaScraper");
app.get("/api/test-ipau", async (req, res) => {
  const total = await runIPAustraliaScraper();
  res.json({ message: `IP Australia scan complete. ${total} new match(es) found.` });
});

const { runIPONZScraper } = require("./scrapers/iponzScraper");
app.get("/api/test-iponz", async (req, res) => {
  const total = await runIPONZScraper();
  res.json({ message: `IPONZ scan complete. ${total} new match(es) found.` });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});