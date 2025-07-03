const express = require('express');
const { subscribeSymbol, unsubscribeSymbol } = require('../lib/wsClient');
const { hasActivePosition } = require('../lib/dbClient');

const router = express.Router();

router.post('/subscribe', async (req, res) => {
  const { symbol } = req.body;
  await subscribeSymbol(symbol); // avoids duplicate sub inside function
  res.json({ success: true });
});

router.post('/unsubscribe', async (req, res) => {
  const { symbol } = req.body;

  const hasActive = await hasActivePosition(symbol);
  if (hasActive) return res.status(400).json({ error: "Active position exists" });

  await unsubscribeSymbol(symbol); // removes only if ref count = 0
  res.json({ success: true });
});

module.exports = router;
