const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
const { subscribeSymbol, unsubscribeSymbol } = require('./wsClient');
const { hasActivePosition } = require('./dbClient');

const sqs = new SQSClient({ region: 'ap-southeast-1' });
const QUEUE_URL = 'https://sqs.ap-southeast-1.amazonaws.com/614745601820/order-tracking-queue';

async function pollQueue() {
  const cmd = new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 5
  });

  try {
    const data = await sqs.send(cmd);
    if (!data.Messages || data.Messages.length === 0) {
      return setTimeout(pollQueue, 100);
    }

    for (const msg of data.Messages) {
      const task = JSON.parse(msg.Body);

      if (task.type === 'subscribe') {
        await subscribeSymbol(task.symbol);
        console.log(`✅ Subscribed to symbol: ${task.symbol}`);
      }

      if (task.type === 'unsubscribe') {
        const hasActive = await hasActivePosition(task.symbol);

        if (hasActive) {
          console.log(`🔒 Symbol ${task.symbol} NOT unsubscribed — active positions exist.`);
        } else {
          await unsubscribeSymbol(task.symbol);
          console.log(`✅ Unsubscribed from symbol: ${task.symbol}`);
        }
      }

      // Always delete message from queue after processing
      await sqs.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: msg.ReceiptHandle
      }));
    }
  } catch (err) {
    console.error('❌ Error processing SQS message:', err);
  }

  setTimeout(pollQueue, 100);
}

pollQueue();
