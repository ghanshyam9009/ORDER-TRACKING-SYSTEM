import crypto from 'crypto';

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  QueryCommand,
  PutItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

// 🔹 High-level Document Client (lets you use plain JS objects)
import { DynamoDBDocumentClient , PutCommand} from "@aws-sdk/lib-dynamodb";


// 🔸 Create base client
const ddbClient = new DynamoDBClient({});

// 🔸 Create document client for simplified data handling
const docClient = DynamoDBDocumentClient.from(ddbClient);

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
const ORDER_TABLE = "incrypto-dev-orders"


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
      orderCategory: item.orderCategory?.S || "LONG_LIMIT",
      contributionAmount:item.contributionAmount?.N || "0",
      status,
    };
  });
}






// async function fetchAllOpenPositions() {
//   const allowedPosIds = [
//     "INPS-1758365031055",
//     // "INPS-1753087055641",
//     // Add more posIds here if needed
//   ];

//   const cmd = new ScanCommand({
//     TableName: TABLE_NAME,
//     FilterExpression: "#st = :status OR #st = :pending",
//     ExpressionAttributeNames: {
//       "#st": "status",
//     },
//     ExpressionAttributeValues: {
//       ":status": { S: "CLOSED" },
//       ":pending": { S: "PENDING" },
//     },
//   });

//   const data = await db.send(cmd);

//   return data.Items.filter(
//     (item) =>
//       item.assetSymbol &&
//       item.userId &&
//       item.positionId &&
//       allowedPosIds.includes(item.positionId.S)
//   ).map((item) => {
//     const status = item.status.S;
//     const stopLoss = item.stopLoss?.M?.triggerPrice?.N
//       ? parseFloat(item.stopLoss.M.triggerPrice.N)
//       : undefined;
//     const takeProfit = item.takeProfit?.M?.triggerPrice?.N
//       ? parseFloat(item.takeProfit.M.triggerPrice.N)
//       : undefined;

//     return {
//       symbol: item.assetSymbol.S,
//       userId: item.userId.S,
//       posId: item.positionId.S,
//       orderID: item.orderID?.S,
//       type:
//         stopLoss && takeProfit
//           ? "sltp"
//           : stopLoss
//           ? "sl"
//           : takeProfit
//           ? "tp"
//           : "manual",
//       sl: stopLoss,
//       tp: takeProfit,
//       entryPrice: item.entryPrice?.N
//         ? parseFloat(item.entryPrice.N)
//         : undefined,
//       leverage: item.leverage?.N ? parseFloat(item.leverage.N) : undefined,
//       marginUsed: item.contributionAmount?.N
//         ? parseFloat(item.contributionAmount.N)
//         : undefined,
//       quantity: item.quantity?.N
//         ? parseFloat(item.quantity.N)
//         : item.initialQuantity?.N
//         ? parseFloat(item.initialQuantity.N)
//         : 0,
//       positionType: item.positionType?.S || "LONG",
//       orderType: item.orderType?.S || "MARKET",
//       orderCategory: item.orderCategory?.S || "LONG_LIMIT",
//       contributionAmount:item.contributionAmount?.N || "0",
      
//       status,
//     };
//     console.log("hhhh",contributionAmount)
//   });

 
// }


async function fetchPositionById(posId) {
  try {
    const cmd = new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        positionId: { S: posId },
      },
    });

    const data = await db.send(cmd);
    console.log(data)
    const item = data.Item;
    if (!item) {
      console.warn(`⚠️ No item found for posId=${posId}`);
      return null;
    }

    const stopLoss = item.stopLoss?.M?.triggerPrice?.N
      ? parseFloat(item.stopLoss.M.triggerPrice.N)
      : undefined;
    const takeProfit = item.takeProfit?.M?.triggerPrice?.N
      ? parseFloat(item.takeProfit.M.triggerPrice.N)
      : undefined;

    return {
      symbol: item.assetSymbol?.S,
      userId: item.userId?.S,
      posId: item.positionId?.S,
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
      status: item.status?.S,
      orderCategory: item.orderCategory?.S || "LONG_LIMIT",
    };
  } catch (err) {
    console.error(`❌ Error in fetchPositionById(${posId}):`, err.message);
    return null;
  }
}



async function closePosition(
  userId,
  posId,
  status,
  {
    exitPrice,
    triggerType,
    orderID,
    triggerPrice,
    currency = "USD",
    feeInINR = 20,
    leverage = 200,
  }
) {
  const safeExitPrice = parseFloat(triggerPrice ?? exitPrice);
  const BROKERAGE_FEE = 0.23;
  

  // Default values
  let safeEntryPrice = 0;
  let safeQuantity = 0;
  let contributionAmount = 0;
  let positionType = "LONG";
  let symbol = "";
  let stopLoss = 0;
  let takeProfit = 0;
  let orderSource = "system";
  let strategy = "auto";
  let lotsize = 0;

  try {
    const fetchCmd = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "positionId = :pid",
      ExpressionAttributeValues: {
        ":pid": { S: posId },
      },
    });

    const data = await db.send(fetchCmd);
    const item = data?.Items?.[0];

    if (!item) {
      console.error(`❌ Position not found: ${posId}`);
      return;
    }

    // ✅ Extract from DB
    safeEntryPrice = parseFloat(item.entryPrice?.N ?? "0");
    safeQuantity = parseFloat(item.quantity?.N ?? "0"); // use `quantity` NOT `lot`
    contributionAmount = parseFloat(item.contributionAmount?.N ?? "0");
    stopLoss = parseFloat(item.stopLoss?.M?.triggerPrice?.N ?? "0");
    takeProfit = parseFloat(item.takeProfit?.M?.triggerPrice?.N ?? "0");
    positionType = item.positionType?.S ?? "LONG";
    symbol = item.assetSymbol?.S || item.symbol?.S || "";
    orderSource = item.metadata?.M?.source?.S || "system";
    strategy = item.metadata?.M?.strategy?.S || "auto";
    lotsize = parseFloat(item.lot?.N ?? "0");

    // 🔍 Logs
    console.log("📥 DB Values Used:");
    console.log("   ▶ Entry Price:", safeEntryPrice);
    console.log("   ▶ Quantity:", safeQuantity);
    console.log("   ▶ Contribution Amount:", contributionAmount);
    console.log("   ▶ SL Trigger Price:", stopLoss);
    console.log("   ▶ TP Trigger Price:", takeProfit);
    console.log("   ▶ Position Type:", positionType);
    console.log("   ▶ Symbol:", symbol);
    console.log("   ▶ lot:", lotsize);
  } catch (err) {
    console.error(`❌ Error fetching position ${posId}`, err);
    return;
  }

  if (
    !Number.isFinite(safeExitPrice) ||
    !Number.isFinite(safeEntryPrice) ||
    !Number.isFinite(safeQuantity)
  ) {
    console.error("❌ Invalid numeric values", {
      safeExitPrice,
      safeEntryPrice,
      safeQuantity,
    });
    return;
  }

  // 🔹 Realized PnL
  let realizedPnL =
    positionType === "LONG" || positionType === "LONG_LIMIT"
      ? (safeExitPrice - safeEntryPrice) * safeQuantity
      : (safeEntryPrice - safeExitPrice) * safeQuantity;
  realizedPnL = parseFloat(realizedPnL.toFixed(8));

  const closedAt = new Date().toISOString();
  const positionClosedType =
    triggerType === "sl"
      ? "auto_SL"
      : triggerType === "tp"
      ? "auto_TP"
      : triggerType === "sltp"
      ? "auto_TPSL"
      : "";

  // 1️⃣ Update Position Table
  // await db.send(
  //   new UpdateItemCommand({
  //     TableName: TABLE_NAME,
  //     Key: { positionId: { S: posId } },
  //     UpdateExpression:
  //       "SET #status = :status, exitPrice = :exitPrice, closedAt = :closedAt, pnl = :pnl, positionClosedType = :pct ,  quantity = :quantity",
  //     ExpressionAttributeNames: { "#status": "status" },
  //     ExpressionAttributeValues: {
  //       ":status": { S: status },
  //       ":exitPrice": { N: safeExitPrice.toString() },
  //       ":closedAt": { S: closedAt },
  //       ":pnl": { N: realizedPnL.toString() },
  //       ":pct": { S: positionClosedType },
  //       ":quantity":{N: }
  //     },
  //   })
  // );


  await db.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { positionId: { S: posId } },
      UpdateExpression:
        "SET #status = :status, exitPrice = :exitPrice, closedAt = :closedAt, pnl = :pnl, positionClosedType = :pct, quantity = :quantity, lot = :lot, contributionAmount = :ca",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": { S: status },
        ":exitPrice": { N: safeExitPrice.toString() },
        ":closedAt": { S: closedAt },
        ":pnl": { N: realizedPnL.toString() },
        ":pct": { S: positionClosedType },
        ":quantity": { N: "0" },
        ":lot": { N: "0" },
        ":ca": { N: "0" },
      },
    })
  );
  

  // 2️⃣ Update original order status
  if (orderID) {
    try {
      await db.send(
        new UpdateItemCommand({
          TableName: "incrypto-dev-orders",
          Key: { orderId: { S: orderID } },
          UpdateExpression: "SET #status = :status, updatedAt = :updatedAt ,  pnl = :pnl",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": { S: "FILLED" },
            ":updatedAt": { S: closedAt },
            ":pnl": { N: realizedPnL.toString() },
          },
        })
      );
    } catch (err) {
      console.error(`❌ Order update failed for ${orderID}`, err);
    }
  }

  // 3️⃣ Save auto-close order
  const newOrderId = `INOR-${Date.now()}`;

  // const toNumAttr = (val) => ({ N: val.toString() });

  const N = (val) => ({ N: val.toString() });
  console.log(orderID)

  const orderPayload = {
    orderId: newOrderId,
    userId,
    createdAt: closedAt,
    updatedAt: closedAt,
    fee: BROKERAGE_FEE,
    feeInINR,
    leverage,
    lot: lotsize,
    marginAmount: contributionAmount,
    currency,
    status: "FILLED",
    orderType: "MARKET",
    // operation: positionType === "LONG" ? "SELL" : "BUY",
    operation: (positionType === "LONG" || positionType === "LONG_LIMIT") ? "SELL" : "BUY",
    orderMessage: `SLTP order opened @${safeExitPrice}; margin=${contributionAmount.toFixed(8)}, fee=${BROKERAGE_FEE.toFixed(8)}`,
    stockSymbol: symbol,
    price: safeExitPrice,
    // priceInINR: 0,
    size: safeQuantity,
    totalValue: safeExitPrice * safeQuantity,
    stopLoss,
    takeProfit,
    positionID: posId,
    source: currency,
    pnl,realizedPnL,
    metaData: {
      source: orderSource,
      strategy,
    }
  };
  await docClient.send(new PutCommand({
    TableName: "incrypto-dev-orders",
    Item: orderPayload,
  }));
  


    if (realizedPnL !== 0) {
    await updateUserFunds(userId, realizedPnL);
    console.log("💸 User funds updated for PnL:", realizedPnL);
    await logFundTrackerEntry({
      userId,
      credit: realizedPnL > 0 ? realizedPnL : 0,
      deduction: realizedPnL < 0 ? -realizedPnL : 0,
      invoker: positionClosedType,
      orderId: newOrderId,
      reason: `PnL for ${triggerType?.toUpperCase()}`,
      type: realizedPnL >= 0 ? "CREDIT" : "DEBIT",
    });
  }

  if (contributionAmount > 0) {
    await updateUserFunds(userId, contributionAmount);
    console.log("💸 User funds updated for margin return:", contributionAmount);
    await logFundTrackerEntry({
      userId,
      credit: contributionAmount,
      deduction: 0,
      invoker: positionClosedType,
      orderId: newOrderId,
      reason: "Margin Returned",
      type: "CREDIT",
    });
  }

  await updateUserFunds(userId, -BROKERAGE_FEE);
  console.log("💸 User funds updated for brokerage fee:", BROKERAGE_FEE);
  await logFundTrackerEntry({
    userId,
    credit: 0,
    deduction: BROKERAGE_FEE,
    invoker: positionClosedType,
    orderId: newOrderId,
    reason: "Brokerage Fees",
    type: "DEBIT",
  });
}

async function logFundTrackerEntry({
  userId,
  credit = 0,
  deduction = 0,
  invoker = "",
  orderId = "",
  reason = "",
  type = "CREDIT",
}) {
  const getCmd = new GetItemCommand({
    TableName: FUNDS_TABLE,
    Key: { userId: { S: userId } },
  });

  const res = await db.send(getCmd);
  const currentBalance = parseFloat(res?.Item?.availableBalance?.N ?? "0");
  const netChange = credit - deduction;
  const newBalance = parseFloat((currentBalance + netChange).toFixed(8));

  const trackerId = `FT-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();

  const trackerItem = {
    trackerId,
    userId,
    credit,
    deduction,
    invoker,
    orderId,
    priceBeforeDeductions: currentBalance,
    priceAfterDeductions: newBalance,
    reason,
    timestamp,
    totalBalance: newBalance,
    type,
  };



  await docClient.send(
    new PutCommand({
      TableName: "incrypto-dev-fund-tracker",
      Item: trackerItem,
    })
  );
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
      ":amount": { N: amount.toFixed(8).toString() },
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
  console.log(orderId);

  const cmd = new UpdateItemCommand({
    TableName: ORDER_TABLE,
    Key: {
      orderId: { S: orderId },
    },
    UpdateExpression: "SET #status = :filled",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":filled": { S: "FILLED" },
    },
  });

  await db.send(cmd);
  console.log(`✅ Order ${orderId} marked as FILLED at price ${filledPrice}`);
}



async function markOrderAsOpened(orderId, filledPrice) {
  console.log(orderId);

  const cmd = new UpdateItemCommand({
    TableName: ORDER_TABLE,
    Key: {
      orderId: { S: orderId },
    },
    UpdateExpression: "SET #status = :open",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":open": { S: "OPEN" },
    },
  });

  await db.send(cmd);
  console.log(`✅ Order ${orderId} marked as FILLED at price ${filledPrice}`);
}


async function markPositionAsOpen(posId) {
  const cmd = new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      positionId: { S: posId },
    },
    UpdateExpression: "SET #status = :open",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":open": { S: "OPEN" },
    },
  });

  await db.send(cmd);
  console.log(`🟢 Position ${posId} marked as OPEN in DB`);
}


export {
  fetchAllOpenPositions,
  closePosition,
  hasActivePosition,
  markOrderAsFilled,
  fetchPositionById,
  markOrderAsOpened,
  markPositionAsOpen,
};
