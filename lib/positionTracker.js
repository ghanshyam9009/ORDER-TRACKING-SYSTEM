import axios from 'axios';
// import db  from './dbClient.js'
import db, {
  closePosition,
  markOrderAsFilled
} from './dbClient.js';


const positions = {}; // { symbol: { userId: { posId: position } } }
const pendingPositions = {}; // { symbol: { userId: { posId: position } } }

async function addPosition(symbol, userId, position) {
  const isPending = position.status === 'PENDING';
  const isTrackable = ['sl', 'tp', 'sltp'].includes(position.type);

  if (isPending) {
    if (!pendingPositions[symbol]) pendingPositions[symbol] = {};
    if (!pendingPositions[symbol][userId]) pendingPositions[symbol][userId] = {};
    pendingPositions[symbol][userId][position.posId] = position;
    console.log(`🔄 Pending position added for ${symbol} - ${userId} - ${position.posId}`);
  }

  if (isTrackable && !isPending) {
    if (!positions[symbol]) positions[symbol] = {};
    if (!positions[symbol][userId]) positions[symbol][userId] = {};
    positions[symbol][userId][position.posId] = position;
  }

  // ✅ Always subscribe if symbol is new in either map
  const totalUsers = {
    ...positions[symbol],
    ...pendingPositions[symbol]
  };

  if (Object.keys(totalUsers || {}).length === 1) {
    try {
      await axios.post('https://cryptobknd.click/get-subscribe', { symbol });
      console.log(`🟢 API called to subscribe: ${symbol}`);
    } catch (error) {
      console.error(`❌ Subscribe API failed for ${symbol}:`, error.message);
    }
  }
}


async function updatePosition(symbol, userId, posId, updates) {
  let currentPos;

  if (positions[symbol]?.[userId]?.[posId]) {
    Object.assign(positions[symbol][userId][posId], updates);
    currentPos = positions[symbol][userId][posId];
    console.log(`🔄 Position updated for ${symbol} - ${userId} - ${posId}`);
  } else if (pendingPositions[symbol]?.[userId]?.[posId]) {
    Object.assign(pendingPositions[symbol][userId][posId], updates);
    currentPos = pendingPositions[symbol][userId][posId];
    console.log(`🔄 Pending position updated for ${symbol} - ${userId} - ${posId}`);
  }

  // ✅ Check if it became OPEN and is trackable, then move to positions
  if (
    currentPos &&
    ['sl', 'tp', 'sltp'].includes(currentPos.type) &&
    currentPos.status === 'OPEN'
  ) {
    await addPosition(symbol, userId, {
      ...currentPos,
      quantity: currentPos.quantity || 0
    });

    // ✅ Optionally: Remove from pendingPositions if it exists there
    if (pendingPositions[symbol]?.[userId]?.[posId]) {
      delete pendingPositions[symbol][userId][posId];
      if (Object.keys(pendingPositions[symbol][userId]).length === 0) {
        delete pendingPositions[symbol][userId];
      }
      if (Object.keys(pendingPositions[symbol]).length === 0) {
        delete pendingPositions[symbol];
      }
    }
  }
}


async function removePosition(symbol, userId, posId) {
  if (positions[symbol]?.[userId]?.[posId]) {
    delete positions[symbol][userId][posId];
    if (Object.keys(positions[symbol][userId]).length === 0) delete positions[symbol][userId];
    if (Object.keys(positions[symbol]).length === 0) {
      delete positions[symbol];
      try {
        await axios.post('https://cryptobknd.click/get-unsubscribe', { symbol });
        console.log(`🔴 API called to unsubscribe: ${symbol}`);
      } catch (error) {
        console.error(`❌ Unsubscribe API failed for ${symbol}:`, error.message);
      }
    }
  }
}

async function check(symbol, markPrice, symbolUsers) {
  console.log(`🧐 Checking symbol ${symbol} @ ${markPrice}`);

  const pendingUserMap = pendingPositions[symbol] || {};

  // Clone userIds to avoid issues if we delete mid-iteration
  const userIds = Object.keys(pendingUserMap);

  for (const userId of userIds) {
    const userPending = pendingUserMap[userId];
    if (!userPending) continue;

    const posIds = Object.keys(userPending);

    for (const posId of posIds) {
      const pos = userPending[posId];
      if (!pos) continue;

      const entryPrice = pos.entryPrice ?? pos.order?.price;
      const orderType = pos.orderType;

      const isLimitOrder = orderType === 'LIMIT';
      const isValidEntry = typeof entryPrice === 'number' && Number.isFinite(entryPrice);

      const shouldOpen = isLimitOrder &&
        isValidEntry &&
        Number(markPrice.toFixed(2)) === Number(entryPrice.toFixed(2));

      if (!shouldOpen) continue;

      // ✅ Recheck if still exists before processing
      if (!pendingPositions[symbol]?.[userId]?.[posId]) continue;

      console.log(`✅ LIMIT ORDER HIT: userId=${userId}, posId=${posId}, entryPrice=${entryPrice}`);

      await db.markOrderAsFilled(posId, markPrice);

      const filledPos = {
        ...pos,
        status: 'OPEN',
        entryPrice: markPrice,
        quantity: pos.quantity ?? 0
      };

      const isTrackable = ['sl', 'tp', 'sltp'].includes(filledPos.type);
      if (isTrackable) {
        await addPosition(symbol, userId, {
          ...filledPos,
          quantity: filledPos.quantity || 0
        });
      }

      // ✅ Safe Deletion
      if (pendingPositions[symbol]?.[userId]?.[posId]) {
        delete pendingPositions[symbol][userId][posId];

        if (Object.keys(pendingPositions[symbol][userId]).length === 0) {
          delete pendingPositions[symbol][userId];
        }
        if (Object.keys(pendingPositions[symbol]).length === 0) {
          delete pendingPositions[symbol];
        }
      }
    }
  }

  // ✅ Now check active live positions
  for (const userId in symbolUsers) {
    for (const posId in symbolUsers[userId]) {
      const pos = symbolUsers[userId][posId];
      const info = `userId=${userId}, posId=${posId}, type=${pos.type}`;

      if (pos.type === 'sl' && markPrice <= pos.sl) {
        console.log(`🔻 SL HIT: ${info}, sl=${pos.sl}`);
        await closePosition(userId, posId, 'CLOSED', {
          exitPrice: markPrice,
          triggerPrice: pos.sl,
          positionType: pos.positionType || 'LONG',
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
          triggerType: 'sl' 
        });
        await removePosition(symbol, userId, posId);
      }

      if (pos.type === 'tp' && markPrice >= pos.tp) {
        console.log(`🚀 TP HIT: ${info}, tp=${pos.tp}`);
        await closePosition(userId, posId, 'CLOSED', {
          exitPrice: markPrice,
          triggerPrice: pos.tp,
          positionType: pos.positionType || 'LONG',
          entryPrice: pos.entryPrice,
          quantity: pos.quantity,
          triggerType: 'tp' 
        });
        await removePosition(symbol, userId, posId);
      }

      if (pos.type === 'sltp') {
        if (markPrice <= pos.sl) {
          console.log(`🔻 SLTP: ${info}, sl=${pos.sl}`);
          await closePosition(userId, posId, 'CLOSED', {
            exitPrice: markPrice,
            triggerPrice: pos.sl,
            positionType: pos.positionType || 'LONG',
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: 'sl' 
          });
          await removePosition(symbol, userId, posId);
        } else if (markPrice >= pos.tp) {
          console.log(`🚀 SLTP: ${info}, tp=${pos.tp}`);
          await closePosition(userId, posId, 'CLOSED', {
            exitPrice: markPrice,
            triggerPrice: pos.tp,
            positionType: pos.positionType || 'LONG',
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: 'tp' 
          });
          await removePosition(symbol, userId, posId);
        }
      }
    }
  }
}



export {
  addPosition,
  updatePosition,
  removePosition,
  positions,
  pendingPositions,
  check
};
