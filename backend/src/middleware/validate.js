const { badRequest } = require('../utils/errors');

/**
 * Validates and replaces req.body / req.query / req.params with the parsed result.
 * Unknown keys are stripped, which also blocks mass-assignment of fields such as
 * `role`, `college`, `paidPaise` or `status` that a schema does not explicitly allow.
 */
const validate = ({ body, query, params } = {}) => (req, res, next) => {
  const issues = [];
  const run = (schema, source, assign) => {
    if (!schema) return;
    const result = schema.safeParse(req[source] ?? {});
    if (result.success) assign(result.data);
    else {
      result.error.issues.forEach(i => issues.push({ field: [source, ...i.path].join('.').replace(/^body\./, ''), message: i.message }));
    }
  };
  run(body, 'body', data => { req.body = data; });
  run(query, 'query', data => { req.validatedQuery = data; });
  run(params, 'params', data => { req.params = data; });
  if (issues.length) return next(badRequest('Please correct the highlighted fields.', issues, 'VALIDATION_ERROR'));
  if (!req.validatedQuery) req.validatedQuery = {};
  next();
};

module.exports = validate;
