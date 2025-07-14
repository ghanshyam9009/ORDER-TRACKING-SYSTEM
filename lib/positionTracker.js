import axios from "axios";
// import db  from './dbClient.js'
import db, { closePosition, markOrderAsFilled } from "./dbClient.js";

const positions = {}; // { symbol: { userId: { posId: position } } }
const pendingPositions = {}; // { symbol: { userId: { posId: position } } }

async function addPosition(symbol, userId, position) {
  const isPending = position.status === "PENDING";
  const isTrackable = ["sl", "tp", "sltp"].includes(position.type);

  console.log("📥 [addPosition] Adding Position", { symbol, userId, posId: position.posId, isPending, isTrackable });

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
    console.log(`✅ Tracked position added for ${symbol} - ${userId} - ${position.posId}`);
  }

  const totalUsers = {
    ...positions[symbol],
    ...pendingPositions[symbol],
  };

  if (Object.keys(totalUsers || {}).length === 1) {
    try {
      await axios.post("https://cryptobknd.click/get-subscribe", { symbol });
      console.log(`🟢 API called to subscribe: ${symbol}`);
    } catch (error) {
      console.error(`❌ Subscribe API failed for ${symbol}:`, error.message);
    }
  }
}

function getDerivedPositionType(pos) {
  const sl = Number(pos?.stopLoss?.triggerPrice?.N ?? pos?.sl);
  const tp = Number(pos?.takeProfit?.triggerPrice?.N ?? pos?.tp);
  console.log("📊 [getDerivedPositionType] Input:", { sl, tp });

  const hasSL = !isNaN(sl) && sl > 0;
  const hasTP = !isNaN(tp) && tp > 0;

  if (hasSL && hasTP) return "sltp";
  if (hasSL) return "sl";
  if (hasTP) return "tp";
  return null;
}

async function updatePosition(symbol, userId, posId, updates) {
  console.log("🧩 [updatePosition] Inputs:", { symbol, userId, posId, updates });

  let currentPos;
  if (positions[symbol]?.[userId]?.[posId]) {
    currentPos = positions[symbol][userId][posId];
    console.log("📌 [Before Update] Tracked Position:", currentPos);
    Object.assign(currentPos, updates);
    console.log("📌 [After Update] Updated:", currentPos);
  } else if (pendingPositions[symbol]?.[userId]?.[posId]) {
    currentPos = pendingPositions[symbol][userId][posId];
    console.log("📌 [Before Update] Pending Position:", currentPos);
    Object.assign(currentPos, updates);
    console.log("📌 [After Update] Updated:", currentPos);
  } else {
    console.warn(`⚠️ Position not found for update: ${symbol} - ${userId} - ${posId}`);
    return;
  }

  if (!currentPos.stopLoss && currentPos.sl) {
    console.log(`🔍 Adding stopLoss structure to posId=${posId}`);
    currentPos.stopLoss = { triggerPrice: { N: String(currentPos.sl) } };
  }

  if (!currentPos.takeProfit && currentPos.tp) {
    console.log(`🔍 Adding takeProfit structure to posId=${posId}`);
    currentPos.takeProfit = { triggerPrice: { N: String(currentPos.tp) } };
  }

  const derivedType = getDerivedPositionType(currentPos);

  if (!derivedType) {
    console.warn(`⚠️ No SL/TP found. Skipping re-add for ${symbol} - ${userId} - ${posId}`);
    console.warn("📌 Position Snapshot:", currentPos);
    return;
  }

  if (currentPos.status === "OPEN" && ["sl", "tp", "sltp"].includes(derivedType)) {
    const isFirstTimeTrackable = !positions[symbol]?.[userId]?.[posId];

    await addPosition(symbol, userId, {
      ...currentPos,
      type: derivedType,
      quantity: currentPos.quantity || 0,
    });

    if (isFirstTimeTrackable) {
      try {
        await axios.post("https://cryptobknd.click/get-subscribe", { symbol });
        console.log(`🟢 Auto-subscribed on first SL/TP for ${symbol}`);
      } catch (err) {
        console.error(`❌ Auto-subscribe failed for ${symbol}:`, err.message);
      }
    }

    console.log(`✅ Live trackable position added from update: ${symbol} - ${userId} - ${posId}`);
  }
}

async function removePosition(symbol, userId, posId) {
  console.log(`🗑️ Removing position: ${symbol} - ${userId} - ${posId}`);

  if (positions[symbol]?.[userId]?.[posId]) {
    delete positions[symbol][userId][posId];
    if (Object.keys(positions[symbol][userId]).length === 0) delete positions[symbol][userId];
    if (Object.keys(positions[symbol]).length === 0) {
      delete positions[symbol];
      try {
        await axios.post("https://cryptobknd.click/get-unsubscribe", { symbol });
        console.log(`🔴 API called to unsubscribe: ${symbol}`);
      } catch (error) {
        console.error(`❌ Unsubscribe API failed for ${symbol}:`, error.message);
      }
    }
  }
}

async function check(symbol, markPrice, symbolUsers) {
  console.log(`🧐 Checking symbol ${symbol} @ ${markPrice}`);
  // console.log(orderID)

  const pendingUserMap = pendingPositions[symbol] || {};
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
      const orderID = pos.orderID;
      const isLimitOrder = orderType === "LIMIT";
      const isValidEntry =
        typeof entryPrice === "number" && Number.isFinite(entryPrice);

      const shouldOpen =
        isLimitOrder &&
        isValidEntry &&
        Number(markPrice.toFixed(2)) === Number(entryPrice.toFixed(2));

      if (!shouldOpen) continue;

      // ✅ Recheck if still exists before processing
      if (!pendingPositions[symbol]?.[userId]?.[posId]) continue;

      console.log(
        `✅ LIMIT ORDER HIT: userId=${userId}, posId=${posId}, entryPrice=${entryPrice}`
      );

      // 🟢 Mark orderID as FILLED
      if (orderID) {
        await markOrderAsFilled(orderID, markPrice); // Now uses orderID directly
      }

      const filledPos = {
        ...pos,
        status: "OPEN",
        entryPrice: markPrice,
        quantity: pos.quantity ?? 0,
        orderID,
        symbol, // ensure symbol is passed along
      };

      const isTrackable = ["sl", "tp", "sltp"].includes(filledPos.type);
      if (isTrackable) {
        await addPosition(symbol, userId, filledPos);
      }

      // ✅ Remove from pending
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

  // ✅ Check Active Positions
  for (const userId in symbolUsers) {
    for (const posId in symbolUsers[userId]) {
      const pos = symbolUsers[userId][posId];
      const info = `userId=${userId}, posId=${posId}, type=${pos.type}`;
      const orderID = pos.orderID;
      const posSymbol = symbol; // enforce symbol presence

      // 🟥 SL hit
      if (pos.type === "sl") {
        const slHit =
          pos.positionType === "SHORT"
            ? markPrice >= pos.sl
            : markPrice <= pos.sl;
        if (slHit) {
          console.log(`🔻 SL HIT: ${info}, sl=${pos.sl}`);
          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.sl,
            triggerPrice: pos.sl,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "sl",
            orderID:pos.orderID,
          });
          console.log("kdnvsk",orderID)
          await removePosition(posSymbol, userId, posId);
        }
      }

      // 🟩 TP hit
      if (pos.type === "tp") {
        const tpHit =
          pos.positionType === "SHORT"
            ? markPrice <= pos.tp
            : markPrice >= pos.tp;
        if (tpHit) {
          console.log(`🚀 TP HIT: ${info}, tp=${pos.tp}`);
          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.tp,
            triggerPrice: pos.tp,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "tp",
            orderID:pos.orderID,
          });
          await removePosition(posSymbol, userId, posId);
        }
      }

      // 🟨 SLTP (both conditions)
      if (pos.type === "sltp") {
        const slHit =
          pos.positionType === "SHORT"
            ? markPrice >= pos.sl
            : markPrice <= pos.sl;
        const tpHit =
          pos.positionType === "SHORT"
            ? markPrice <= pos.tp
            : markPrice >= pos.tp;

        if (slHit) {
          console.log(`🔻 SLTP: ${info}, sl=${pos.sl}`);
          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.sl,
            triggerPrice: pos.sl,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "sl",
            orderID:pos.orderID,
          });
          await removePosition(posSymbol, userId, posId);
        } else if (tpHit) {
          console.log(`🚀 SLTP: ${info}, tp=${pos.tp}`);
          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.tp,
            triggerPrice: pos.tp,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "tp",
            orderID:pos.orderID,
          });
          await removePosition(posSymbol, userId, posId);
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
  check,
};
