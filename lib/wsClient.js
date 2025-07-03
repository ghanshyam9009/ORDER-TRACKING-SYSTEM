const WebSocket = require('ws');
const axios = require('axios');
const { check, positions,pendingPositions } = require('./positionTracker');

let ws;
const activeSubscriptions = new Set();

function connectToWebSocket() {
  ws = new WebSocket('wss://cryptobknd.click/?category=ordertracking');
  // ws = new WebSocket('ws://localhost:5000/?category=ordertracking');

  ws.on('open', () => console.log('✅ WebSocket connected'));
  ws.on('message', (raw) => {
    const { type, data } = JSON.parse(raw);
    if (type === 'order-tracking-data' && data) {
      for (const symbol in data) {
        const markPrice = data[symbol]?.mark_price;
  
        if (!markPrice) continue;
  
        const live = positions[symbol] || {};
        const pending = pendingPositions[symbol] || {};
  
        if (Object.keys(live).length > 0 || Object.keys(pending).length > 0) {
          console.log("🧐 Calling check() for", symbol, markPrice);
          check(symbol, markPrice, live);
        }
      }
    }
  });
  
  ws.on('close', () => console.log('❌ WebSocket disconnected'));
}

async function subscribeSymbol(symbol) {
  if (!activeSubscriptions.has(symbol)) {
    try {
      await axios.post('https://cryptobknd.click/get-subscribe', { symbol });
      ws.send(JSON.stringify({ action: 'subscribe', symbol }));
      activeSubscriptions.add(symbol);
      console.log(`🔔 Subscribed to ${symbol}`);
    } catch (error) {
      console.error(`❌ Failed to subscribe to ${symbol}:`, error.message);
    }
  }
}

async function unsubscribeSymbol(symbol) {
  if (activeSubscriptions.has(symbol)) {
    try {
      await axios.post('https://cryptobknd.click/get-unsubcribe', { symbol });
      ws.send(JSON.stringify({ action: 'unsubscribe', symbol }));
      activeSubscriptions.delete(symbol);
      console.log(`🔕 Unsubscribed from ${symbol}`);
    } catch (error) {
      console.error(`❌ Failed to unsubscribe from ${symbol}:`, error.message);
    }
  }
}

module.exports = { connectToWebSocket, subscribeSymbol, unsubscribeSymbol };
