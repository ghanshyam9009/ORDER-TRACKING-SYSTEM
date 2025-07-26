
import axios from "axios";
import db, {
  closePosition,
  markOrderAsFilled,
  fetchPositionById,
  markOrderAsOpened,
  markPositionAsOpen,
} from "./dbClient.js";

const positions = {}; // { symbol: { userId: { posId: position } } }
const pendingPositions = {}; // { symbol: { userId: { posId: position } } }

async function addPosition(symbol, userId, position) {
  const isPending = position.status === "PENDING";

  // 🧠 Derive correct type from sl/tp values
  const sl = Number(position.sl);
  const tp = Number(position.tp);
  const hasSL = !isNaN(sl) && sl > 0;
  const hasTP = !isNaN(tp) && tp > 0;
  const orderCategory = position.orderCategory || "UNKNOWN";
  // const contributionAmount = position.contributionAmount || 0;


  let derivedType = null;
  if (hasSL && hasTP) derivedType = "sltp";
  else if (hasSL) derivedType = "sl";
  else if (hasTP) derivedType = "tp";

  const isTrackable = !!derivedType;

  console.log("📥 [addPosition] Adding Position", {
    symbol,
    userId,
    posId: position.posId,
    isPending,
    isTrackable,
    sl,
    tp,
    derivedType,
    orderCategory,
  });

  if (isPending) {
    if (!pendingPositions[symbol]) pendingPositions[symbol] = {};
    if (!pendingPositions[symbol][userId])
      pendingPositions[symbol][userId] = {};
    pendingPositions[symbol][userId][position.posId] = position;
    console.log(
      `🔄 Pending position added for ${symbol} - ${userId} - ${position.posId}`
    );
  }

  if (isTrackable && !isPending) {
    position.type = derivedType;
    if (!positions[symbol]) positions[symbol] = {};
    if (!positions[symbol][userId]) positions[symbol][userId] = {};
    positions[symbol][userId][position.posId] = position;
    console.log(
      `✅ Tracked position added for ${symbol} - ${userId} - ${position.posId}`
    );
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
  console.log("🧩 [updatePosition] Inputs:", {
    symbol,
    userId,
    posId,
    updates,
  });

  let currentPos;

  // 1. Try in-memory first
  if (positions[symbol]?.[userId]?.[posId]) {
    currentPos = positions[symbol][userId][posId];
    console.log("📌 [Before Update] Tracked Position:", currentPos);
  } else if (pendingPositions[symbol]?.[userId]?.[posId]) {
    currentPos = pendingPositions[symbol][userId][posId];
    console.log("📌 [Before Update] Pending Position:", currentPos);
  } else {
    // 2. Not found → Fetch from DB
    console.warn(`⚠️ Position not found in memory: ${symbol} - ${userId} - ${posId}`);
    const found = await fetchPositionById(posId);

    if (!found) {
      console.error(`❌ Could not find position in DB: ${symbol} - ${userId} - ${posId}`);
      return;
    }

    // 3. Merge updates BEFORE calling addPosition
    const updated = {
      ...found,
      ...updates,
    };

    // Normalize SL/TP structure
    if (!updated.stopLoss && updated.sl) {
      updated.stopLoss = { triggerPrice: { N: String(updated.sl) } };
    }
    if (!updated.takeProfit && updated.tp) {
      updated.takeProfit = { triggerPrice: { N: String(updated.tp) } };
    }

    // Derive type
    const derivedType = getDerivedPositionType(updated);
    if (derivedType && updated.status === "OPEN") {
      updated.type = derivedType;
    }

    // ✅ Add updated version to memory
    await addPosition(updated.symbol, updated.userId, updated);
    console.log(`✅ Re-added from DB (with updates): ${symbol} - ${userId} - ${posId}`);
    return; // ✅ No need to continue further
  }

  // 4. Apply update if position was already in memory
  Object.assign(currentPos, updates);
  console.log("📌 [After Update] Updated Position:", currentPos);

  // 5. Normalize SL/TP structure
  if (!currentPos.stopLoss && currentPos.sl) {
    currentPos.stopLoss = { triggerPrice: { N: String(currentPos.sl) } };
    console.log(`🔍 Added stopLoss structure to posId=${posId}`);
  }

  if (!currentPos.takeProfit && currentPos.tp) {
    currentPos.takeProfit = { triggerPrice: { N: String(currentPos.tp) } };
    console.log(`🔍 Added takeProfit structure to posId=${posId}`);
  }

  // 6. Derive type again and re-add if eligible
  const derivedType = getDerivedPositionType(currentPos);

  if (!derivedType) {
    console.warn(`⚠️ No SL/TP found. Skipping re-add for ${symbol} - ${userId} - ${posId}`);
    return;
  }

  if (currentPos.status === "OPEN" && ["sl", "tp", "sltp"].includes(derivedType)) {
    await addPosition(symbol, userId, {
      ...currentPos,
      type: derivedType,
    });

    console.log(`✅ Live trackable position updated: ${symbol} - ${userId} - ${posId}`);
  }
}


async function check(symbol, markPrice, symbolUsers) {
console.log(`🧐 Checking symbol ${symbol} @ ${markPrice}`);

  const pendingUserMap = pendingPositions[symbol] || {};
  const userIds = Object.keys(pendingUserMap);

  for (const userId of userIds) {
    const userPending = pendingUserMap[userId];
    if (!userPending) continue;

    const posIds = Object.keys(userPending);

    for (const userId of userIds) {
      const userPending = pendingUserMap[userId];
      if (!userPending) continue;
    
      const posIds = Object.keys(userPending);
    
      for (const posId of posIds) {
        const pos = userPending[posId];
        if (!pos) continue;
    
        const entryPrice = pos.entryPrice ?? pos.order?.price;
        const orderCategory = pos.orderCategory; // ✅ used instead of orderType
        const orderID = pos.orderID;
        const posType = pos.type;
        const isLongLimitOrder = orderCategory === "LONG_LIMITORDER";
        const isShortLimitOrder = orderCategory === "SHORT_LIMITORDER";
        // const isValidEntry = typeof entryPrice === "number" && Number.isFinite(entryPrice);
        const isValidEntry = true;
        
    
        let shouldOpen = false;
    
        if (isValidEntry) {
          if (orderCategory === "LONG_LIMIT") {
            console.log(`📈 Tracking LONG_LIMITORDER: markPrice=${markPrice}, entryPrice=${entryPrice}`);
            if (markPrice >= entryPrice) {
              console.log(`✅ LONG_LIMITORDER HIT: markPrice (${markPrice}) >= entryPrice (${entryPrice})`);
              shouldOpen = true;
            }
          } else if (orderCategory === "SHORT_LIMIT") {
            console.log(`📉 Tracking SHORT_LIMITORDER: markPrice=${markPrice}, entryPrice=${entryPrice}`);
            if (markPrice <= entryPrice) {
              console.log(`✅ SHORT_LIMITORDER HIT: markPrice (${markPrice}) <= entryPrice (${entryPrice})`);
              shouldOpen = true;
            }
          }
        }
    
        if (shouldOpen) {
          // ✅ Recheck if still exists before processing
          if (!pendingPositions[symbol]?.[userId]?.[posId]) continue;
    
          console.log(`✅ LIMIT ORDER HIT: userId=${userId}, posId=${posId}, entryPrice=${entryPrice}`);
    
          // ✅ Remove from pending memory
          delete pendingPositions[symbol][userId][posId];
          if (Object.keys(pendingPositions[symbol][userId]).length === 0) {
            delete pendingPositions[symbol][userId];
          }
          if (Object.keys(pendingPositions[symbol]).length === 0) {
            delete pendingPositions[symbol];
          }
    
          // ✅ Mark order as filled
          const posType = pos.type;
          const isTrackable = ["sl", "tp", "sltp"].includes(posType);

          // 🧠 Decide which mark function to call
          if (orderID) {
            if (isTrackable) {
              await markOrderAsOpened(orderID, entryPrice);     // Mark as OPEN
            } else {
              await markOrderAsFilled(orderID, entryPrice);   // Mark as FILLED
            }
          }
    
          // ✅ Update position status
          await markPositionAsOpen(posId);
    
          // const isTrackable = ["sl", "tp", "sltp"].includes(filledPos.type);
          const filledPos = {
            ...pos,
            status: 
            entryPrice,
            quantity: pos.quantity ?? 0,
            orderID,
            symbol,
            // contributionAmount,
            orderCategory,
          };

          if (isTrackable) {
            await addPosition(symbol, userId, filledPos);
          } else {
            // ❌ Not trackable: Unsubscribe from stream
            try {
              await axios.post("https://cryptobknd.click/get-unsubscribe", { symbol });
              console.log(`🔕 Unsubscribed from data stream: ${symbol}`);
            } catch (error) {
              console.error(`❌ Unsubscribe API failed for ${symbol}:`, error.message);
            }
          }
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

          await removePosition(posSymbol, userId, posId);

          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.sl,
            triggerPrice: pos.sl,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "sl",
            orderID: pos.orderID,
            // contributionAmount:pos.contributionAmount,
          });
          console.log("kdnvsk", orderID);
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

          await removePosition(posSymbol, userId, posId);

          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.tp,
            triggerPrice: pos.tp,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "tp",
            orderID: pos.orderID,
            // contributionAmount:pos.contributionAmount,
          });
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

          await removePosition(posSymbol, userId, posId);

          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.sl,
            triggerPrice: pos.sl,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "sl",
            orderID: pos.orderID,
            // contributionAmount:pos.contributionAmount,
          });
        } else if (tpHit) {
          console.log(`🚀 SLTP: ${info}, tp=${pos.tp}`);

          await removePosition(posSymbol, userId, posId);

          await closePosition(userId, posId, "CLOSED", {
            symbol: posSymbol,
            exitPrice: pos.tp,
            triggerPrice: pos.tp,
            positionType: pos.positionType || "LONG",
            entryPrice: pos.entryPrice,
            quantity: pos.quantity,
            triggerType: "tp",
            orderID: pos.orderID,
            // contributionAmount:pos.contributionAmount,
          });
        }
      }
    }
  }
}

async function removePosition(symbol, userId, posId) {
  console.log(`🗑️ Removing position: ${symbol} - ${userId} - ${posId}`);

  if (positions[symbol]?.[userId]?.[posId]) {
    delete positions[symbol][userId][posId];
    if (Object.keys(positions[symbol][userId]).length === 0)
      delete positions[symbol][userId];
    if (Object.keys(positions[symbol]).length === 0) {
      delete positions[symbol];
      try {
        await axios.post("https://cryptobknd.click/get-unsubscribe", {
          symbol,
        });
        console.log(`🔴 API called to unsubscribe: ${symbol}`);
      } catch (error) {
        console.error(
          `❌ Unsubscribe API failed for ${symbol}:`,
          error.message
        );
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
