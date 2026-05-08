const { forbidden } = require('../utils/response');

const PLAN_HIERARCHY = { free: 0, basic: 1, pro: 2 };

function requirePlan(minimumPlan) {
  return (req, res, next) => {
    if (!req.user) {
      return forbidden(res, 'Authentication required');
    }

    if (!req.user.isActive) {
      return forbidden(res, 'Your trial has expired. Upgrade to continue.', true);
    }

    const userPlanLevel = PLAN_HIERARCHY[req.user.plan] || 0;
    const requiredLevel = PLAN_HIERARCHY[minimumPlan] || 0;

    if (userPlanLevel < requiredLevel) {
      return forbidden(
        res,
        `This feature requires the ${minimumPlan} plan or higher.`,
        true
      );
    }

    next();
  };
}

function requireActiveSubscription(req, res, next) {
  if (!req.user) {
    return forbidden(res, 'Authentication required');
  }

  if (!req.user.isActive) {
    return forbidden(res, 'Your subscription has expired. Please upgrade to continue.', true);
  }

  next();
}

function requireOnboarding(req, res, next) {
  if (!req.user.onboarding_complete) {
    return forbidden(res, 'Please complete onboarding before accessing this feature.');
  }
  next();
}

module.exports = { requirePlan, requireActiveSubscription, requireOnboarding };
