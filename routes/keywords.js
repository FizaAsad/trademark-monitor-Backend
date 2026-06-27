const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET /api/keywords — fetch all keywords
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('keywords')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keywords — add a new keyword
router.post('/', async (req, res) => {
  try {
    const { term } = req.body;
    if (!term) return res.status(400).json({ error: 'term is required' });

    const { data, error } = await supabase
      .from('keywords')
      .insert([{ term, active: true }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/keywords/:id — update term or active flag
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.term !== undefined) updates.term = req.body.term;
    if (req.body.active !== undefined) updates.active = req.body.active;

    const { data, error } = await supabase
      .from('keywords')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/keywords/:id — delete a keyword
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('keywords')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Keyword deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
