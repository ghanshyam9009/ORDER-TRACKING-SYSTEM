import WebSocket from 'ws';
import axios from 'axios';
import { check, positions, pendingPositions } from './positionTracker.js';

let ws;
const activeSubscriptions = new Set();
let reconnectInterval = 3000; // 3 seconds
let pingInterval;
let isReconnecting = false;


function connectToWebSocket() {
  ws = new WebSocket('wss://cryptobknd.click/?category=ordertracking');

  ws.on('open', () => {
    console.log('✅ WebSocket connected');

    // Resubscribe all symbols on reconnect
    for (const symbol of activeSubscriptions) {
      ws.send(JSON.stringify({ action: 'subscribe', symbol }));
      console.log(`🔁 Resubscribed to ${symbol}`);
    }

    // Start heartbeat
    startHeartbeat();
  });

  ws.on('message', (raw) => {
    const { type, data } = JSON.parse(raw);

    if (type === 'order-tracking-data' && data) {
      for (const symbol in data) {
        const markPrice = data[symbol]?.mark_price;
        if (!markPrice) {
          console.log(`⚠️ No mark_price for ${symbol}`);
          continue;
        }

        const live = positions[symbol] || {};
        const pending = pendingPositions[symbol] || {};

        if (Object.keys(live).length > 0 || Object.keys(pending).length > 0) {
          console.log(`🧐 Calling check() for ${symbol} with mark price: ${markPrice}`);
          check(symbol, markPrice, live); // or positions[symbol]
        }
      }
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
    cleanupAndReconnect();
  });

  ws.on('close', () => {
    console.log('❌ WebSocket disconnected');
    cleanupAndReconnect();
  });
}

function cleanupAndReconnect() {
  if (ws) {
    try {
      ws.terminate();
    } catch (e) {}
  }

  stopHeartbeat();

  if (!isReconnecting) {
    isReconnecting = true;
    console.log(`🔄 Attempting to reconnect in ${reconnectInterval / 1000}s...`);
    setTimeout(() => {
      isReconnecting = false;
      connectToWebSocket();
    }, reconnectInterval);
  }
}

function startHeartbeat() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 10000); // every 10 seconds
}

function stopHeartbeat() {
  if (pingInterval) clearInterval(pingInterval);
}

async function subscribeSymbol(symbol) {
  if (!activeSubscriptions.has(symbol)) {
    try {
      console.log(`🛰 Subscribing to ${symbol}`);
      await axios.post('https://cryptobknd.click/get-subscribe', { symbol });
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'subscribe', symbol }));
        console.log(`🔔 Subscribed to ${symbol}`);
      } else {
        console.log(`🕓 Queued subscription for ${symbol} (will resend on reconnect)`);
      }
      activeSubscriptions.add(symbol);
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'unsubscribe', symbol }));
        console.log(`🔕 Unsubscribed from ${symbol}`);
      }
      activeSubscriptions.delete(symbol);
    } catch (error) {
      console.error(`❌ Failed to unsubscribe from ${symbol}:`, error.message);
    }
  }
}

export { connectToWebSocket, subscribeSymbol, unsubscribeSymbol };
