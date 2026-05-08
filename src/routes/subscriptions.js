const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const subscriptionService = require('../services/subscriptionService');
const { verifyRazorpayWebhookSignature } = require('../utils/crypto');
const { config } = require('../config/env');
const { success, error } = require('../utils/response');
const logger = require('../config/logger');

router.get('/status', authenticate, async (req, res, next) => {
  try {
    const sub = await subscriptionService.getSubscription(req.user.id);

    return success(res, {
      plan: req.user.plan,
      status: req.user.subscriptionStatus,
      is_active: req.user.isActive,
      trial_end: req.user.trialEnd,
      period_end: req.user.periodEnd,
      subscription: sub,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/create',
  authenticate,
  validate(schemas.createSubscription),
  async (req, res, next) => {
    try {
      const { plan } = req.body;
      const order = await subscriptionService.createSubscriptionOrder(req.user.id, plan);
      return success(res, order, 'Subscription order created');
    } catch (err) {
      if (err.message.includes('already have')) return error(res, err.message, 409);
      if (err.message.includes('Invalid plan')) return error(res, err.message, 400);
      next(err);
    }
  }
);

router.post('/cancel', authenticate, async (req, res, next) => {
  try {
    const sub = await subscriptionService.getSubscription(req.user.id);

    if (!sub || sub.status !== 'active' || !sub.razorpay_subscription_id) {
      return error(res, 'No active subscription to cancel', 400);
    }

    const { immediately = false } = req.body;

    if (immediately) {
      const { cancelRazorpaySubscription } = require('../services/razorpayService');
      await cancelRazorpaySubscription(sub.razorpay_subscription_id, false);
      await subscriptionService.cancelSubscription(sub.razorpay_subscription_id, false);
    } else {
      const { cancelRazorpaySubscription } = require('../services/razorpayService');
      await cancelRazorpaySubscription(sub.razorpay_subscription_id, true);
      await subscriptionService.cancelSubscription(sub.razorpay_subscription_id, true);
    }

    return success(
      res,
      { cancel_at_period_end: !immediately },
      immediately
        ? 'Subscription cancelled immediately'
        : 'Subscription will cancel at period end'
    );
  } catch (err) {
    next(err);
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature' });
    }

    const isValid = verifyRazorpayWebhookSignature(
      JSON.parse(body.toString()),
      signature,
      config.razorpay.webhookSecret
    );

    if (!isValid) {
      logger.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(body.toString());
    const { event: eventType, payload } = event;

    logger.info('Razorpay webhook received', { eventType });

    switch (eventType) {
      case 'subscription.activated':
        await subscriptionService.activateSubscription(
          payload.subscription.entity.id,
          payload.payment?.entity?.id
        );
        break;

      case 'subscription.charged':
        await subscriptionService.renewSubscription(
          payload.subscription.entity.id,
          payload.payment?.entity?.id
        );
        break;

      case 'subscription.cancelled':
        await subscriptionService.cancelSubscription(payload.subscription.entity.id, false);
        break;

      case 'subscription.completed':
        await subscriptionService.expireSubscription(payload.subscription.entity.id);
        break;

      case 'subscription.pending':
        logger.warn('Subscription payment pending', { subscriptionId: payload.subscription.entity.id });
        break;

      default:
        logger.debug('Unhandled webhook event', { eventType });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error('Webhook processing error', { error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
