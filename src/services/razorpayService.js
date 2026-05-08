const Razorpay = require('razorpay');
const { config } = require('../config/env');
const logger = require('../config/logger');

const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

async function createSubscription(plan, razorpayPlanId, userId) {
  if (!razorpayPlanId) {
    throw new Error(`Razorpay plan ID not configured for plan: ${plan}`);
  }

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: 12,
      quantity: 1,
      customer_notify: 1,
      notes: {
        userId,
        plan,
        platform: 'kairos',
      },
    });

    logger.info('Razorpay subscription created', {
      subscriptionId: subscription.id,
      plan,
      userId,
    });

    return subscription;
  } catch (err) {
    logger.error('Razorpay subscription creation failed', { error: err.message, plan, userId });
    throw new Error('Payment provider error. Please try again.');
  }
}

async function cancelRazorpaySubscription(subscriptionId, cancelAtCycleEnd = true) {
  try {
    await razorpay.subscriptions.cancel(subscriptionId, {
      cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0,
    });
    logger.info('Razorpay subscription cancelled', { subscriptionId, cancelAtCycleEnd });
  } catch (err) {
    logger.error('Razorpay cancel failed', { error: err.message, subscriptionId });
    throw new Error('Failed to cancel subscription with payment provider.');
  }
}

async function fetchSubscription(subscriptionId) {
  try {
    return await razorpay.subscriptions.fetch(subscriptionId);
  } catch (err) {
    logger.error('Razorpay fetch failed', { error: err.message, subscriptionId });
    throw new Error('Failed to fetch subscription details.');
  }
}

async function createOrder(amountPaise, currency = 'INR', notes = {}) {
  try {
    return await razorpay.orders.create({
      amount: amountPaise,
      currency,
      notes,
    });
  } catch (err) {
    logger.error('Razorpay order creation failed', { error: err.message });
    throw new Error('Failed to create payment order.');
  }
}

module.exports = {
  createSubscription,
  cancelRazorpaySubscription,
  fetchSubscription,
  createOrder,
};
