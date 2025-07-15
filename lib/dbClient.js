// 🔁 Updated dbClient.js
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";

const db = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

export default db;

const TABLE_NAME = "incrypto-dev-positions";
const FUNDS_TABLE = "incrypto-dev-funds";

async function fetchAllOpenPositions() {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "#st = :status OR #st = :pending",
    ExpressionAttributeNames: {
      "#st": "status",
    },
    ExpressionAttributeValues: {
      ":status": { S: "OPEN" },
      ":pending": { S: "PENDING" },
    },
  });

  const data = await db.send(cmd);

  return data.Items.filter(
    (item) => item.assetSymbol && item.userId && item.positionId
  ).map((item) => {
    const status = item.status.S;
    const stopLoss = item.stopLoss?.M?.triggerPrice?.N
      ? parseFloat(item.stopLoss.M.triggerPrice.N)
      : undefined;
    const takeProfit = item.takeProfit?.M?.triggerPrice?.N
      ? parseFloat(item.takeProfit.M.triggerPrice.N)
      : undefined;

    return {
      symbol: item.assetSymbol.S,
      userId: item.userId.S,
      posId: item.positionId.S,
      orderID:item.orderID.S,
      type:
        stopLoss && takeProfit
          ? "sltp"
          : stopLoss
          ? "sl"
          : takeProfit
          ? "tp"
          : "manual",
      sl: stopLoss,
      tp: takeProfit,
      entryPrice: item.entryPrice?.N
        ? parseFloat(item.entryPrice.N)
        : undefined,
      leverage: item.leverage?.N ? parseFloat(item.leverage.N) : undefined,
      marginUsed: item.contributionAmount?.N
        ? parseFloat(item.contributionAmount.N)
        : undefined,
      // quantity: item.quantity?.N ? parseFloat(item.quantity.N) : undefined,
      quantity: item.quantity?.N
        ? parseFloat(item.quantity.N)
        : item.initialQuantity?.N
        ? parseFloat(item.initialQuantity.N)
        : 0,
      positionType: item.positionType?.S || "LONG",
      orderType: item.orderType?.S || " MARKET",
      status,
    };
  });
}

export async function fetchPositionById(userId, posId) {
  try {
    const cmd = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        userId: { S: userId },
        positionId: { S: posId },
      },
    });

    const data = await db.send(cmd);
    const item = data.Item;

    if (!item) {
      console.warn(`⚠️ No item found for userId=${userId}, posId=${posId}`);
      return null;
    }

    const stopLoss = item.stopLoss?.M?.triggerPrice?.N
      ? parseFloat(item.stopLoss.M.triggerPrice.N)
      : undefined;
    const takeProfit = item.takeProfit?.M?.triggerPrice?.N
      ? parseFloat(item.takeProfit.M.triggerPrice.N)
      : undefined;

    return {
      symbol: item.assetSymbol.S,
      userId: item.userId.S,
      posId: item.positionId.S,
      orderID: item.orderID?.S,
      type:
        stopLoss && takeProfit
          ? "sltp"
          : stopLoss
          ? "sl"
          : takeProfit
          ? "tp"
          : "manual",
      sl: stopLoss,
      tp: takeProfit,
      entryPrice: item.entryPrice?.N
        ? parseFloat(item.entryPrice.N)
        : undefined,
      leverage: item.leverage?.N ? parseFloat(item.leverage.N) : undefined,
      marginUsed: item.contributionAmount?.N
        ? parseFloat(item.contributionAmount.N)
        : undefined,
      quantity: item.quantity?.N
        ? parseFloat(item.quantity.N)
        : item.initialQuantity?.N
        ? parseFloat(item.initialQuantity.N)
        : 0,
      positionType: item.positionType?.S || "LONG",
      orderType: item.orderType?.S || "MARKET",
      status: item.status.S,
    };
  } catch (err) {
    console.error(`❌ Error in fetchPositionById(${userId}, ${posId}):`, err.message);
    return null;
  }
}

async function closePosition(
  userId,
  posId,
  status,
  {
    exitPrice,
    entryPrice,
    quantity,
    positionType,
    triggerType,
    stockSymbol,
    leverage = 200,
    feeInINR = 20,
    currency = "USD",
    triggerPrice,
    orderID, // ✅ NEW: passed from caller
  }
) {
  const safeExitPrice = parseFloat(triggerPrice ?? exitPrice);
  const safeEntryPrice = parseFloat(entryPrice);
  const safeQuantity = parseFloat(quantity);
  const BROKERAGE_FEE = 0.23529412;

  const isValid =
    Number.isFinite(safeExitPrice) &&
    Number.isFinite(safeEntryPrice) &&
    Number.isFinite(safeQuantity);
  if (!isValid) {
    console.error(`❌ Invalid numeric inputs for position ${posId}`, {
      exitPrice,
      entryPrice,
      quantity,
    });
    return;
  }

  let realizedPnL =
    positionType === "LONG"
      ? (safeExitPrice - safeEntryPrice) * safeQuantity
      : (safeEntryPrice - safeExitPrice) * safeQuantity;

  realizedPnL -= BROKERAGE_FEE;
  realizedPnL = parseFloat(realizedPnL.toFixed(8));

  let contributionAmount = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  let symbol = stockSymbol;
  let lot = safeQuantity;
  let orderSource = "system";
  let strategy = "auto";

  try {
    const fetchCmd = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "positionId = :pid",
      ExpressionAttributeValues: {
        ":pid": { S: posId },
      },
    });

    const data = await db.send(fetchCmd);
    const item =
      Array.isArray(data.Items) && data.Items.length > 0 ? data.Items[0] : null;

    if (item) {
      contributionAmount = item?.contributionAmount?.N
        ? parseFloat(item.contributionAmount.N)
        : 0;
      stopLoss = item?.sl?.N ? parseFloat(item.sl.N) : 0;
      takeProfit = item?.tp?.N ? parseFloat(item.tp.N) : 0;
      symbol = item?.symbol?.S || item?.assetSymbol?.S || stockSymbol || "UNKNOWN";
      lot = item?.lot?.N ? parseFloat(item.lot.N) : safeQuantity;

      const meta = item?.metaData?.M;
      orderSource = meta?.source?.S || "system";
      strategy = meta?.strategy?.S || "auto";
    }
  } catch (err) {
    console.error(`❌ Error fetching position data for ${posId}:`, err);
  }

  const totalReturn = parseFloat((realizedPnL + contributionAmount).toFixed(8));

  let positionClosedType = "";
  if (triggerType === "sl") positionClosedType = "auto_SL";
  else if (triggerType === "tp") positionClosedType = "auto_TP";
  else if (triggerType === "sltp") positionClosedType = "auto_TPSL";

  const closedAt = new Date().toISOString();

  const updateCmd = new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      positionId: { S: posId },
    },
    UpdateExpression:
      "SET #status = :status, exitPrice = :exitPrice, closedAt = :closedAt, realizedPnL = :pnl, positionClosedType = :pct",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":status": { S: status },
      ":exitPrice": { N: safeExitPrice.toString() },
      ":closedAt": { S: closedAt },
      ":pnl": { N: realizedPnL.toString() },
      ":pct": { S: positionClosedType },
    },
  });

  await db.send(updateCmd);

  // ✅ Mark original order as FILLED (if orderID exists)
  console.log("mil gai order id ",orderID)
  if (orderID) {
    try {
      const orderUpdate = new UpdateItemCommand({
        TableName: "incrypto-dev-orders",
        Key: {
          orderId: { S: orderID },
        },
        UpdateExpression: "SET #status = :status, price = :price, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": { S: "FILLED" },
          ":price": { N: safeExitPrice.toString() },
          ":updatedAt": { S: closedAt },
        },
      });
      
      console.log("horhaa hai ",orderID)
      await db.send(orderUpdate);
    } catch (err) {
      console.error(`❌ Failed to update original order ${orderID}:`, err);
    }
  }

  // ✅ Insert auto-close order record
  const orderId = `INOR-${Date.now()}`;
  const orderPayload = {
    orderId: { S: orderId },
    userId: { S: userId },
    createdAt: { S: closedAt },
    updatedAt: { S: closedAt },
    fee: { N: BROKERAGE_FEE.toFixed(8) },
    feeInINR: { N: feeInINR.toString() },
    leverage: { N: leverage.toString() },
    lot: { N: lot.toString() },
    marginAmount: { N: "0" },
    currency: { S: currency },
    status: { S: "FILLED" },
    orderType: { S: "MARKET" },
    operation: { S: positionType === "LONG" ? "SELL" : "BUY" },
    orderMessage: { S: "Order filled at market" },
    stockSymbol: { S: symbol || "UNKNOWN" },
    price: { N: safeExitPrice.toString() },
    priceInINR: { N: "0" },
    size: { N: lot.toString() },
    totalValue: { N: (safeExitPrice * lot).toString() },
    stopLoss: { N: stopLoss.toString() },
    takeProfit: { N: takeProfit.toString() },
    positionID: { S: posId },
    metaData: {
      M: {
        source: { S: orderSource },
        strategy: { S: strategy },
        operation: { S: positionType === "LONG" ? "SELL" : "BUY" },
        orderType: { S: "MARKET" },
        sourceCurrency: { S: currency },
        size: { N: lot.toString() },
      },
    },
  };

  console.log(orderPayload)

  try {
    const orderCmd = new PutItemCommand({
      TableName: "incrypto-dev-orders",
      Item: orderPayload,
    });
    await db.send(orderCmd);
  } catch (err) {
    console.error(`❌ Failed to save auto-close order record for ${posId}:`, err);
    console.error("🔍 Payload that caused error:", JSON.stringify(orderPayload, null, 2));
  }

  // ✅ Wallet update
  try {
    await updateUserFunds(userId, totalReturn);
  } catch (err) {
    console.error(`❌ Failed to update funds for user ${userId}`, err);
  }
}


async function updateUserFunds(userId, amount) {
  const updateCmd = new UpdateItemCommand({
    TableName: FUNDS_TABLE,
    Key: {
      userId: { S: userId },
    },
    UpdateExpression:
      "SET availableBalance = if_not_exists(availableBalance, :zero) + :amount",
    ExpressionAttributeValues: {
      ":amount": { N: amount.toString() },
      ":zero": { N: "0" },
    },
  });
  await db.send(updateCmd);
}

async function hasActivePosition(symbol) {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "#st = :open AND #sym = :symbol",
    ExpressionAttributeNames: {
      "#st": "status",
      "#sym": "assetSymbol",
    },
    ExpressionAttributeValues: {
      ":open": { S: "OPEN" },
      ":symbol": { S: symbol },
    },
  });

  const data = await db.send(cmd);
  return data.Items.length > 0;
}

async function markOrderAsFilled(orderId, filledPrice) {
  const cmd = new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      positionId: { S: orderId },
    },
    UpdateExpression: "SET #status = :open, entryPrice = :price",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":open": { S: "OPEN" },
      ":price": { N: filledPrice.toString() },
    },
  });

  await db.send(cmd);
  console.log(`✅ Order ${orderId} marked as OPEN at price ${filledPrice}`);
}

export {
  fetchAllOpenPositions,
  closePosition,
  hasActivePosition,
  markOrderAsFilled,
  fetchPositionById,
};
