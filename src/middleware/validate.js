const Joi = require('joi');
const { validationError } = require('../utils/response');

function validate(schema, target = 'body') {
  return (req, res, next) => {
    const data = target === 'body' ? req.body : target === 'query' ? req.query : req.params;

    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/['"]/g, ''),
      }));
      return validationError(res, errors);
    }

    if (target === 'body') req.body = value;
    else if (target === 'query') req.query = value;
    else req.params = value;

    next();
  };
}

const schemas = {
  register: Joi.object({
    email: Joi.string().email().lowercase().required(),
    password: Joi.string().min(8).max(72).required(),
    name: Joi.string().min(2).max(100).required(),
  }),

  login: Joi.object({
    email: Joi.string().email().lowercase().required(),
    password: Joi.string().required(),
  }),

  refreshToken: Joi.object({
    refresh_token: Joi.string().required(),
  }),

  connectPlatform: Joi.object({
    platform: Joi.string().valid('chess.com', 'lichess').required(),
    username: Joi.string().min(2).max(50).required(),
  }),

  chatMessage: Joi.object({
    message: Joi.string().min(1).max(2000).required(),
    session_id: Joi.string().uuid().optional(),
    game_id: Joi.string().uuid().optional(),
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(100).optional(),
    coach_personality: Joi.string().valid('strict', 'encouraging', 'analytical', 'balanced').optional(),
    preferred_platform: Joi.string().valid('chess.com', 'lichess').optional(),
    preferred_time_class: Joi.string().valid('bullet', 'blitz', 'rapid', 'classical').optional(),
    timezone: Joi.string().max(50).optional(),
  }),

  paginationQuery: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    platform: Joi.string().valid('chess.com', 'lichess').optional(),
    time_class: Joi.string().valid('bullet', 'blitz', 'rapid', 'classical').optional(),
    result: Joi.string().valid('win', 'loss', 'draw').optional(),
    sort: Joi.string().valid('played_at', 'user_rating', 'accuracy_score').default('played_at'),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  createSubscription: Joi.object({
    plan: Joi.string().valid('basic', 'pro').required(),
  }),

  generateReport: Joi.object({
    report_type: Joi.string().valid('weekly', 'monthly', 'opening', 'full_profile').required(),
    date_range_start: Joi.date().iso().optional(),
    date_range_end: Joi.date().iso().optional(),
  }),
};

module.exports = { validate, schemas };
