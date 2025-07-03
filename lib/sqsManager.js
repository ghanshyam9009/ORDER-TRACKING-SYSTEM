const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const sqs = new SQSClient({ region: 'ap-southeast-1' });
const QUEUE_URL = 'https://sqs.ap-southeast-1.amazonaws.com/614745601820/order-tracking-queue';

async function enqueue(task) {
  const cmd = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(task),
  });
  await sqs.send(cmd);
}

module.exports = { enqueue };