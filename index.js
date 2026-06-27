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

// Routes (will be added as we build each module)
// app.use('/api/keywords', require('./routes/keywords'));
// app.use('/api/matches', require('./routes/matches'));
// app.use('/api/scan', require('./routes/scan'));
// app.use('/api/reports', require('./routes/reports'));
// app.use('/api/settings', require('./routes/settings'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
