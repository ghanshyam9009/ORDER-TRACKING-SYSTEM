import express from 'express';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
import cors from 'cors';
dotenv.config();


// ✅ Allow any origin on any port

import { connectToWebSocket } from './lib/wsClient.js';
import { addPosition, removePosition,updatePosition,positions,pendingPositions } from './lib/positionTracker.js';
import { fetchAllOpenPositions } from './lib/dbClient.js'; // ✅ Named import

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));



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
      orderID,
      quantity,
      orderType,
      positionType,
      orderCategory,
      contributionAmount,
    } = pos;

    console.log(orderID)
     
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
      positionObj.orderID=orderID;
      positionObj.orderCategory=orderCategory;
      positionObj.contributionAmount=contributionAmount;

      await addPosition(symbol, userId, positionObj);
      continue;
    }

    // ✅ Case 2: Add pending limit order (not trackable, but needed to detect fill)
    if (isPendingLimitOrder) {
      // await addPosition(symbol, userId, {
      //   posId,
      //   status,
      //   orderID,
      //   orderType,
      //   positionType,
      //   quantity
      // } );

      await addPosition(symbol, userId, {
        posId,
        type,         // may be undefined
        sl, tp,       // optional
        entryPrice,
        leverage,
        marginUsed,
        quantity,
        orderType,
        positionType,
        status,
        orderID,
        orderCategory,
        contributionAmount,
      });
      
      console.log(`🔔 Added pending limit order for ${symbol} (${userId})`);
    }
  }
}


// everything else stays unchanged

await start();

// keep existing routes and cron jobs...


async function forceDeletePosition(symbol, userId, posId) {
  let found = false;

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
    return { ok: true };
  } else {
    throw new Error('Position not found');
  }
}

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
    orderID,
    orderCategory,
    contributionAmount,
    ...rest
  } = req.body;

  console.log(req.body)

  const isNewPosition =
    symbol &&
    userId &&
    posId &&
    (type || status === 'PENDING') &&
    (entryPrice) &&
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
          positionType,
          orderID,
          orderCategory,
          contributionAmount,
        };
        await addPosition(symbol, userId, newPos);
        console.log(`✅ [Add] Tracked position added: ${symbol} - ${userId}`);
      } else if (isPendingLimitOrder) {
        const newLimit = {
          posId,
          status,
          orderID,
          orderType,
          positionType,
          quantity,
          orderCategory,
          contributionAmount,
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

app.post('/update', async (req, res) => {
  const { symbol, userId, posId, updates } = req.body;

  if (!symbol || !userId || !posId || !updates) {
    return res.status(400).send({
      ok: false,
      message: 'Missing required fields: symbol, userId, posId, updates',
    });
  }

  const slEmpty = updates.sl === null || updates.sl === 'null' || updates.sl === undefined;
  const tpEmpty = updates.tp === null || updates.tp === 'null' || updates.tp === undefined;

  try {
    // ❗ Check if both SL and TP are null-like → force delete
    if (slEmpty && tpEmpty) {
      console.warn(`⚠️ SL & TP both null → triggering force delete for ${symbol} - ${userId} - ${posId}`);

      // Optional: Use your actual force-delete logic here
      // await hitAPI('/force-delete', { symbol, userId, posId });
      await forceDeletePosition(symbol, userId, posId);

      return res.send({
        ok: true,
        message: 'Force delete triggered due to null SL & TP',
      });
    }

    // ✅ Proceed with normal update
    await updatePosition(symbol, userId, posId, updates);
    console.log(`🔄 [Update] Position updated via /update: ${symbol} - ${userId} - ${posId}`);
    res.send({ ok: true });

  } catch (err) {
    console.error('❌ Error in /update:', err);
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





const timezone = 'Asia/Kolkata';

// // [12:47 PM IST]
// cron.schedule('48 12 * * *', async () => {
//   console.log('🔔 [12:47 PM IST] Starting controlled shutdown sequence...');
//   try {
//     await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/pause-stream');
//     console.log('✅ Step 1: DynamoDB stream paused');

//     await axios.post('https://q8i5zqsopa.execute-api.ap-southeast-1.amazonaws.com/default/incrypto-dev-auto-squareoff-AutoSquareOffFunction-xbFlwBZcRFih');
//     console.log('✅ Step 2: Square-off lambda hit');

//     console.log('✅ Step 3: Limit Order lambda hit');
//   } catch (err) {
//     console.error('❌ Error in shutdown sequence:', err);
//   }
// }, { timezone });

// // [12:54 PM IST]
// cron.schedule('51 12 * * *', async () => {
//   console.log('🔁 [12:54 PM IST] Restarting central server...');
//   try {
//     await axios.post('https://fyhrl9cxpc.execute-api.ap-southeast-1.amazonaws.com/default/central_server_restarter');
//     console.log('✅ Step 4: Central server restart API called');
//   } catch (err) {
//     console.error('❌ Restart error:', err);
//   }
// }, { timezone });

// // [12:56 PM IST]
// cron.schedule('52 12 * * *', async () => {
//   console.log('🔄 [12:56 PM IST] Re-enabling DynamoDB stream...');
//   try {
//     await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/resume-stream');
//     console.log('✅ Step 5: DynamoDB stream resumed');
//   } catch (err) {
//     console.error('❌ Error resuming stream:', err);
//   }
// }, { timezone });

// // [12:57 PM IST]
// cron.schedule('53 12 * * *', async () => {
//   console.log('🧨 [12:57 PM IST] Restarting this Node.js server...');
//   try {
//     console.log('✅ Step 6: Exiting process to trigger server restart...');
//     process.exit(0);
//   } catch (err) {
//     console.error('❌ Error during self-restart:', err);
//   }
// }, { timezone });

// Scheduled Cron Tasks (IST-based)
cron.schedule('25 13 * * *', async () => {
  console.log('🔔 [1:25 PM IST] Starting controlled shutdown sequence...');
  try {
    await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/pause-stream');
    console.log('✅ Step 1: DynamoDB stream paused');

    await axios.post('https://q8i5zqsopa.execute-api.ap-southeast-1.amazonaws.com/default/incrypto-dev-auto-squareoff-AutoSquareOffFunction-xbFlwBZcRFih');
    console.log('✅ Step 2: Square-off lambda hit');

    console.log('✅ Step 3: Limit Order lambda hit');
  } catch (err) {
    console.error('❌ Error in shutdown sequence:', err);
  }
}, {
  timezone: 'Asia/Kolkata'
});

cron.schedule('32 13 * * *', async () => {
  console.log('🔁 [1:32 PM IST] Restarting central server...');
  try {
    await axios.post('https://fyhrl9cxpc.execute-api.ap-southeast-1.amazonaws.com/default/central_server_restarter');
    console.log('✅ Step 4: Central server restart API called');
  } catch (err) {
    console.error('❌ Restart error:', err);
  }
}, {
  timezone: 'Asia/Kolkata'
});

cron.schedule('34 13 * * *', async () => {
  console.log('🔄 [1:34 PM IST] Re-enabling DynamoDB stream...');
  try {
    await axios.post('https://7qc4q6cxgg.execute-api.ap-southeast-1.amazonaws.com/prod/resume-stream');
    console.log('✅ Step 5: DynamoDB stream resumed');
  } catch (err) {
    console.error('❌ Error resuming stream:', err);
  }
}, {
  timezone: 'Asia/Kolkata'
});

cron.schedule('35 13 * * *', async () => {
  console.log('🧨 [1:35 PM IST] Restarting this Node.js server...');
  try {
    console.log('✅ Step 6: Exiting process to trigger server restart...');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during self-restart:', err);
  }
}, {
  timezone: 'Asia/Kolkata'
});




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API server running on port ${PORT}`));
