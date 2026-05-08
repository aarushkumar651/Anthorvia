const { query, transaction } = require('../config/database');
const razorpayService = require('./razorpayService');
const { config } = require('../config/env');
const logger = require('../config/logger');

async function getSubscription(userId) {
  const result = await query(
    `SELECT * FROM subscriptions WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function createSubscriptionOrder(userId, plan) {
  const planConfig = config.plans[plan];
  if (!planConfig) throw new Error(`Invalid plan: ${plan}`);

  const sub = await getSubscription(userId);

  if (sub && sub.status === 'active') {
    throw new Error('You already have an active subscription');
  }

  const rzpSubscription = await razorpayService.createSubscription(
    plan,
    planConfig.razorpayPlanId,
    userId
  );

  await query(
    `UPDATE subscriptions
     SET razorpay_subscription_id = $1, plan = $2, updated_at = NOW()
     WHERE user_id = $3`,
    [rzpSubscription.id, plan, userId]
  );

  return {
    subscriptionId: rzpSubscription.id,
    razorpayKeyId: config.razorpay.keyId,
    plan,
    amount: planConfig.amount,
    currency: 'INR',
  };
}

async function activateSubscription(razorpaySubscriptionId, paymentId) {
  const subResult = await query(
    `SELECT user_id, plan FROM subscriptions WHERE razorpay_subscription_id = $1`,
    [razorpaySubscriptionId]
  );

  if (subResult.rows.length === 0) {
    logger.warn('Webhook: subscription not found', { razorpaySubscriptionId });
    return;
  }

  const { user_id: userId, plan } = subResult.rows[0];
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await transaction(async (client) => {
    await client.query(
      `UPDATE subscriptions
       SET status = 'active', current_period_start = $1, current_period_end = $2, updated_at = NOW()
       WHERE razorpay_subscription_id = $3`,
      [now, periodEnd, razorpaySubscriptionId]
    );

    if (paymentId) {
      await client.query(
        `INSERT INTO payments (user_id, razorpay_payment_id, razorpay_subscription_id, amount_paise, status, plan)
         VALUES ($1, $2, $3, $4, 'captured', $5)
         ON CONFLICT (razorpay_payment_id) DO NOTHING`,
        [userId, paymentId, razorpaySubscriptionId, config.plans[plan]?.amount || 0, plan]
      );
    }
  });

  logger.info('Subscription activated', { userId, plan, razorpaySubscriptionId });
}

async function renewSubscription(razorpaySubscriptionId, paymentId) {
  const subResult = await query(
    `SELECT user_id, plan, current_period_end FROM subscriptions WHERE razorpay_subscription_id = $1`,
    [razorpaySubscriptionId]
  );

  if (subResult.rows.length === 0) return;

  const { user_id: userId, plan, current_period_end } = subResult.rows[0];
  const newPeriodStart = new Date(current_period_end);
  const newPeriodEnd = new Date(newPeriodStart);
  newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

  await transaction(async (client) => {
    await client.query(
      `UPDATE subscriptions
       SET status = 'active', current_period_start = $1, current_period_end = $2, updated_at = NOW()
       WHERE razorpay_subscription_id = $3`,
      [newPeriodStart, newPeriodEnd, razorpaySubscriptionId]
    );

    if (paymentId) {
      await client.query(
        `INSERT INTO payments (user_id, razorpay_payment_id, razorpay_subscription_id, amount_paise, status, plan)
         VALUES ($1, $2, $3, $4, 'captured', $5)
         ON CONFLICT (razorpay_payment_id) DO NOTHING`,
        [userId, paymentId, razorpaySubscriptionId, config.plans[plan]?.amount || 0, plan]
      );
    }
  });

  logger.info('Subscription renewed', { userId, plan });
}

async function cancelSubscription(razorpaySubscriptionId, atPeriodEnd = true) {
  const subResult = await query(
    `SELECT user_id FROM subscriptions WHERE razorpay_subscription_id = $1`,
    [razorpaySubscriptionId]
  );

  if (subResult.rows.length === 0) return;

  if (atPeriodEnd) {
    await query(
      `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW()
       WHERE razorpay_subscription_id = $1`,
      [razorpaySubscriptionId]
    );
  } else {
    await query(
      `UPDATE subscriptions
       SET status = 'cancelled', cancelled_at = NOW(), cancel_at_period_end = FALSE, updated_at = NOW()
       WHERE razorpay_subscription_id = $1`,
      [razorpaySubscriptionId]
    );
  }

  logger.info('Subscription cancelled', { razorpaySubscriptionId, atPeriodEnd });
}

async function expireSubscription(razorpaySubscriptionId) {
  await query(
    `UPDATE subscriptions
     SET status = 'expired', cancel_at_period_end = FALSE, updated_at = NOW()
     WHERE razorpay_subscription_id = $1`,
    [razorpaySubscriptionId]
  );
}

async function handleCancelAtPeriodEnd(userId) {
  await query(
    `UPDATE subscriptions
     SET status = 'expired', updated_at = NOW()
     WHERE user_id = $1
       AND cancel_at_period_end = TRUE
       AND current_period_end < NOW()`,
    [userId]
  );
}

module.exports = {
  getSubscription,
  createSubscriptionOrder,
  activateSubscription,
  renewSubscription,
  cancelSubscription,
  expireSubscription,
};
