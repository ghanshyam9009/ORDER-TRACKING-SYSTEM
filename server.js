import express from 'express';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
dotenv.config();

import { connectToWebSocket } from './lib/wsClient.js';
import { addPosition, removePosition,updatePosition,positions,pendingPositions } from './lib/positionTracker.js';
import { fetchAllOpenPositions } from './lib/dbClient.js'; // ✅ Named import

const app = express();
app.use(express.json());

async function start() {
  console.log('🔁 Starting Order Tracking Service...');
  await connectToWebSocket();

  const allPositions = await fetchAllOpenPositions();
  console.log(`📦 Loaded ${allPositions.length} open positions from DB`);

  for (const pos of allPositions) {
    const {
      symbol,
      userId,
      posId,
      type,
      status,
      sl,
      tp,
      entryPrice,
      leverage,
      marginUsed,
      order,
      quantity,
      orderType,
      positionType
    } = pos;
     
    // console.log(pos);
    const isPendingLimitOrder = status === 'PENDING' ;

    // ✅ Case 1: Trackable (sl/tp/sltp)
    const shouldTrack = ['sl', 'tp', 'sltp'].includes(type);
    if (shouldTrack) {
      const positionObj = { posId, type };

      if (type === 'sltp') {
        positionObj.sl = sl;
        positionObj.tp = tp;
      } else if (type === 'sl') {
        positionObj.sl = sl;
      } else if (type === 'tp') {
        positionObj.tp = tp;
      }

      positionObj.entryPrice = entryPrice;
      positionObj.leverage = leverage;
      positionObj.marginUsed = marginUsed;
      positionObj.quantity=quantity;
      positionObj.orderType=orderType;
      positionObj.positionType=positionType;
      positionObj.status=status;

      await addPosition(symbol, userId, positionObj);
      continue;
    }

    // ✅ Case 2: Add pending limit order (not trackable, but needed to detect fill)
    if (isPendingLimitOrder) {
      await addPosition(symbol, userId, {
        posId,
        status,
        order,
        orderType,
        positionType,
        quantity
      } );

      console.log(`🔔 Added pending limit order for ${symbol} (${userId})`);
    }
  }
}


// everything else stays unchanged

await start();

// keep existing routes and cron jobs...

// ✅ Add or Update Position
app.post('/add-or-update', async (req, res) => {
  const {
    symbol,
    userId,
    posId,
    type,
    status,
    entryPrice,
    sl,
    tp,
    orderType,
    positionType,
    quantity,
    order,
    ...rest
  } = req.body;

  const isNewPosition =
    symbol &&
    userId &&
    posId &&
    (type || status === 'PENDING') &&
    (entryPrice || order) &&
    quantity !== undefined;

  try {
    if (isNewPosition) {
      const isTrackable = ['sl', 'tp', 'sltp'].includes(type);
      const isPendingLimitOrder = status === 'PENDING';

      if (isTrackable) {
        const newPos = {
          posId,
          type,
          sl,
          tp,
          entryPrice,
          status,
          quantity,
          orderType,
          positionType
        };
        await addPosition(symbol, userId, newPos);
        console.log(`✅ [Add] Tracked position added: ${symbol} - ${userId}`);
      } else if (isPendingLimitOrder) {
        const newLimit = {
          posId,
          status,
          order,
          orderType,
          positionType,
          quantity
        };
        await addPosition(symbol, userId, newLimit);
        console.log(`✅ [Add] Pending LIMIT order added: ${symbol} - ${userId}`);
      }
    } else {
      const updates = {
        entryPrice,
        sl,
        tp,
        status,
        ...rest
      };
      await updatePosition(symbol, userId, posId, updates);
      console.log(`✏️ [Update] Position updated: ${symbol} - ${userId} - ${posId}`);
    }

    res.send({ ok: true });
  } catch (err) {
    console.error('❌ Error in /add-or-update:', err);
    res.status(500).send({ ok: false, message: 'Server error' });
  }
});

// ✅ Force Delete Position from Tracking
app.post('/force-delete', async (req, res) => {
  const { symbol, userId, posId } = req.body;

  let found = false;

  try {
    if (positions[symbol]?.[userId]?.[posId]) {
      delete positions[symbol][userId][posId];
      if (Object.keys(positions[symbol][userId]).length === 0) delete positions[symbol][userId];
      if (Object.keys(positions[symbol]).length === 0) {
        delete positions[symbol];
        await axios.post('https://cryptobknd.click/get-unsubscribe', { symbol });
      }
      found = true;
    }

    if (pendingPositions[symbol]?.[userId]?.[posId]) {
      delete pendingPositions[symbol][userId][posId];
      if (Object.keys(pendingPositions[symbol][userId]).length === 0) delete pendingPositions[symbol][userId];
      if (Object.keys(pendingPositions[symbol]).length === 0) {
        delete pendingPositions[symbol];
        await axios.post('https://cryptobknd.click/get-unsubscribe', { symbol });
      }
      found = true;
    }

    if (found) {
      console.log(`🗑️ [Force Delete] Position removed: ${symbol} - ${userId} - ${posId}`);
      res.send({ ok: true, message: 'Position force-deleted' });
    } else {
      res.status(404).send({ ok: false, message: 'Position not found' });
    }
  } catch (err) {
    console.error('❌ Error in /force-delete:', err);
    res.status(500).send({ ok: false, message: 'Server error' });
  }
});


app.post('/add-position', async (req, res) => {
  const { symbol, userId, posId, type, exitPrice, sl, tp } = req.body;
  const shouldTrack = ['sl', 'tp', 'sltp'].includes(type);
  if (shouldTrack) {
    const pos = { posId, type, exitPrice, sl, tp };
    await addPosition(symbol, userId, pos);
  }
  res.send({ ok: true });
});

app.post('/remove-position', async (req, res) => {
  const { symbol, userId, posId } = req.body;
  await removePosition(symbol, userId, posId);
  res.send({ ok: true });
});

app.post('/get-subscribe', (req, res) => {
  const { symbol } = req.body;
  console.log(`🔔 Subscribed to ${symbol}`);
  res.json({ ok: true, message: `Subscribed to ${symbol}` });
});

app.post('/get-unsubcribe', (req, res) => {
  const { symbol } = req.body;
  console.log(`🔕 Unsubscribed from ${symbol}`);
  res.json({ ok: true, message: `Unsubscribed from ${symbol}` });
});

// Scheduled Cron Tasks
cron.schedule('25 13 * * *', async () => {
  console.log('🔔 [1:25 PM] Starting controlled shutdown sequence...');
  try {
    await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/pause-stream');
    console.log('✅ Step 1: DynamoDB stream paused');

    await axios.post('https://q8i5zqsopa.execute-api.ap-southeast-1.amazonaws.com/default/incrypto-dev-auto-squareoff-AutoSquareOffFunction-xbFlwBZcRFih');
    console.log('✅ Step 2: Square-off lambda hit');

    console.log('✅ Step 3: Limit Order lambda hit');
  } catch (err) {
    console.error('❌ Error in shutdown sequence:', err);
  }
});

cron.schedule('32 13 * * *', async () => {
  console.log('🔁 [1:32 PM] Restarting central server...');
  try {
    await axios.post('https://fyhrl9cxpc.execute-api.ap-southeast-1.amazonaws.com/default/central_server_restarter');
    console.log('✅ Step 4: Central server restart API called');
  } catch (err) {
    console.error('❌ Restart error:', err);
  }
});

cron.schedule('34 13 * * *', async () => {
  console.log('🔄 [1:34 PM] Re-enabling DynamoDB stream...');
  try {
    await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/resume-stream');
    console.log('✅ Step 5: DynamoDB stream resumed');
  } catch (err) {
    console.error('❌ Error resuming stream:', err);
  }
});

cron.schedule('35 13 * * *', async () => {
  console.log('🧨 [1:35 PM] Restarting this Node.js server...');
  try {
    console.log('✅ Step 6: Exiting process to trigger server restart...');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during self-restart:', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API server running on port ${PORT}`));
