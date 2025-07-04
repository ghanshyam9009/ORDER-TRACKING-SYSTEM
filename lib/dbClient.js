
// 🔁 Updated dbClient.js
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  QueryCommand
} from '@aws-sdk/client-dynamodb'

const db = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-southeast-1',
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    : undefined
});

export default db;

const TABLE_NAME = 'incrypto-dev-positions';
const FUNDS_TABLE = 'incrypto-dev-funds';

function isOptionSymbol(symbol) {
  return /^[A-Z]+-\d{1,2}[A-Z]{3}\d{2}-\d+-[CP]$/.test(symbol);
}

function isOptionSymbolExpired(symbol) {
  const match = symbol.match(/^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-[CP]$/);
  if (!match) return false;

  const [_, day, monthStr, yearStr] = match;
  const months = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  };

  const expiryDate = new Date(
    2000 + parseInt(yearStr),
    months[monthStr],
    parseInt(day)
  );

  const now = new Date();
  const currentTimeMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const expiryTimeStart = 13 * 60 + 25;
  const expiryTimeEnd = 13 * 60 + 35;

  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUTC = Date.UTC(expiryDate.getUTCFullYear(), expiryDate.getUTCMonth(), expiryDate.getUTCDate());

  if (todayUTC > expiryUTC) return true;
  if (todayUTC === expiryUTC && currentTimeMinutes >= expiryTimeStart && currentTimeMinutes <= expiryTimeEnd) {
    return true;
  }
  return false;
}



async function fetchAllOpenPositions() {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#st = :status OR #st = :pending',
    ExpressionAttributeNames: {
      '#st': 'status'
    },
    ExpressionAttributeValues: {
      ':status': { S: 'OPEN' },
      ':pending': { S: 'PENDING' }
    }
  });

  const data = await db.send(cmd);

  return data.Items
    .filter(item => item.assetSymbol && item.userId && item.positionId)
    .filter(item => {
      const symbol = item.assetSymbol.S;
      return !(isOptionSymbol(symbol) && isOptionSymbolExpired(symbol));
    })
    .map(item => {
      const status = item.status.S;
      const stopLoss = item.stopLoss?.M?.triggerPrice?.N ? parseFloat(item.stopLoss.M.triggerPrice.N) : undefined;
      const takeProfit = item.takeProfit?.M?.triggerPrice?.N ? parseFloat(item.takeProfit.M.triggerPrice.N) : undefined;

      return {
        symbol: item.assetSymbol.S,
        userId: item.userId.S,
        posId: item.positionId.S,
        type: stopLoss && takeProfit ? 'sltp' : stopLoss ? 'sl' : takeProfit ? 'tp' : 'manual',
        sl: stopLoss,
        tp: takeProfit,
        entryPrice: item.entryPrice?.N ? parseFloat(item.entryPrice.N) : undefined,
        leverage: item.leverage?.N ? parseFloat(item.leverage.N) : undefined,
        marginUsed: item.contributionAmount?.N ? parseFloat(item.contributionAmount.N) : undefined,
        // quantity: item.quantity?.N ? parseFloat(item.quantity.N) : undefined,
        quantity: item.quantity?.N
  ? parseFloat(item.quantity.N)
  : item.initialQuantity?.N
    ? parseFloat(item.initialQuantity.N)
    : 0,
        positionType: item.positionType?.S || 'LONG',
        orderType:item.orderType?.S|| ' MARKET',
        status
      };
    });
}

// import {
//   QueryCommand,
//   UpdateItemCommand
// } from '@aws-sdk/client-dynamodb';

async function closePosition(userId, posId, status, {
  exitPrice,
  entryPrice,
  quantity,
  positionType,
  triggerType // ✅ Add this field to know what triggered the close (sl, tp, sltp)
}) {
  const safeExitPrice = parseFloat(exitPrice);
  const safeEntryPrice = parseFloat(entryPrice);
  const safeQuantity = parseFloat(quantity);

  const isValid = Number.isFinite(safeExitPrice) && Number.isFinite(safeEntryPrice) && Number.isFinite(safeQuantity);

  if (!isValid) {
    console.error(`❌ Invalid numeric inputs for position ${posId}`, { exitPrice, entryPrice, quantity });
    return;
  }

  let realizedPnL = positionType === 'LONG'
    ? (safeExitPrice - safeEntryPrice) * safeQuantity
    : (safeEntryPrice - safeExitPrice) * safeQuantity;
  realizedPnL = parseFloat(realizedPnL.toFixed(8));

  let contributionAmount = 0;
  try {
    const fetchCmd = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'positionId = :pid',
      ExpressionAttributeValues: {
        ':pid': { S: posId }
      }
    });
    const data = await db.send(fetchCmd);
    const item = data.Items?.[0];
    contributionAmount = item?.contributionAmount?.N
      ? parseFloat(item.contributionAmount.N)
      : 0;
  } catch (err) {
    console.error(`❌ Error fetching contributionAmount for ${posId}:`, err);
  }

  const totalReturn = parseFloat((realizedPnL + contributionAmount).toFixed(8));

  // ✅ Add logic for positionClosedType
  let positionClosedType = '';
  if (triggerType === 'sl') positionClosedType = 'auto_SL';
  else if (triggerType === 'tp') positionClosedType = 'auto_TP';
  else if (triggerType === 'sltp') positionClosedType = 'auto_TPSL';

  const cmd = new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      positionId: { S: posId }
    },
    UpdateExpression:
      'SET #status = :status, exitPrice = :exitPrice, closedAt = :closedAt, realizedPnL = :pnl, positionClosedType = :pct',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': { S: status },
      ':exitPrice': { N: safeExitPrice.toString() },
      ':closedAt': { S: new Date().toISOString() },
      ':pnl': { N: realizedPnL.toString() },
      ':pct': { S: positionClosedType }
    }
  });

  await db.send(cmd);

  await updateUserFunds(userId, totalReturn);
}




async function updateUserFunds(userId, amount) {
  const updateCmd = new UpdateItemCommand({
    TableName: FUNDS_TABLE,
    Key: {
      userId: { S: userId }
    },
    UpdateExpression: 'SET availableBalance = if_not_exists(availableBalance, :zero) + :amount',
    ExpressionAttributeValues: {
      ':amount': { N: amount.toString() },
      ':zero': { N: '0' }
    }
  });
  await db.send(updateCmd);
}



async function hasActivePosition(symbol) {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#st = :open AND #sym = :symbol',
    ExpressionAttributeNames: {
      '#st': 'status',
      '#sym': 'assetSymbol'
    },
    ExpressionAttributeValues: {
      ':open': { S: 'OPEN' },
      ':symbol': { S: symbol }
    }
  });

  const data = await db.send(cmd);
  return data.Items.length > 0;
}

async function markOrderAsFilled(orderId, filledPrice) {
  const cmd = new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      positionId: { S: orderId }
    },
    UpdateExpression: 'SET #status = :open, entryPrice = :price',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':open': { S: 'OPEN' },
      ':price': { N: filledPrice.toString() }
    }
  });

  await db.send(cmd);
  console.log(`✅ Order ${orderId} marked as OPEN at price ${filledPrice}`);
}

export {
  fetchAllOpenPositions,
  closePosition,
  hasActivePosition,
  markOrderAsFilled
};
