
import WebSocket from 'ws';
import axios from 'axios';
import { check, positions, pendingPositions } from './positionTracker.js';

let ws;
const activeSubscriptions = new Set();

function connectToWebSocket() {
  ws = new WebSocket('wss://cryptobknd.click/?category=ordertracking');

  ws.on('open', () => console.log('✅ WebSocket connected'));

  ws.on('message', (raw) => {
    const { type, data } = JSON.parse(raw);

    if (type === 'order-tracking-data' && data) {
      // console.log('📥 Incoming data:', data);

      for (const symbol in data) {
        const markPrice = data[symbol]?.mark_price;
        if (!markPrice) {
          console.log(`⚠️ No mark_price for ${symbol}`);
          continue;
        }

        // Log what's available in memory
        // console.log(`🔎 Looking up symbol: ${symbol}`);
        // console.log('🧾 positions:', positions[symbol]);
        // console.log('📦 pendingPositions:', pendingPositions[symbol]);

        const live = positions[symbol] || {};
        const pending = pendingPositions[symbol] || {};

        if (Object.keys(live).length > 0 || Object.keys(pending).length > 0) {
          console.log(`🧐 Calling check() for ${symbol} with mark price: ${markPrice}`);
          check(symbol, markPrice, live);
        } else {
          console.log(`❌ No active or pending position for ${symbol} — skipping check.`);
        }
      }
    }
  });

  ws.on('close', () => console.log('❌ WebSocket disconnected'));
}

async function subscribeSymbol(symbol) {
  if (!activeSubscriptions.has(symbol)) {
    try {
      console.log(`🛰 Subscribing to ${symbol}`);
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
      console.log(`📤 Unsubscribing from ${symbol}`);
      await axios.post('https://cryptobknd.click/get-unsubcribe', { symbol });
      ws.send(JSON.stringify({ action: 'unsubscribe', symbol }));
      activeSubscriptions.delete(symbol);
      console.log(`🔕 Unsubscribed from ${symbol}`);
    } catch (error) {
      console.error(`❌ Failed to unsubscribe from ${symbol}:`, error.message);
    }
  }
}

export { connectToWebSocket, subscribeSymbol, unsubscribeSymbol };
