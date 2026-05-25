/**
 * Request validation middleware factory.
 *
 * Usage:
 *   router.post('/sign', validate(schemas.signUpload), fileController.sign);
 *
 * If validation fails, calls next(AppError) with a structured 400 response
 * listing every invalid field. The controller never executes.
 *
 * If validation passes, req.body is replaced with the Joi-coerced value.
 * This matters: Joi strips unknown fields (abortEarly: false finds ALL errors,
 * not just the first), and coerces types (string '5' → number 5 where declared).
 * The controller always receives a clean, typed object.
 *
 * @param {import('joi').Schema} schema - Joi schema to validate req.body against
 * @param {'body'|'query'|'params'} [source='body'] - Which part of req to validate
 */

"use strict";

const AppError = require("../utils/AppError");

function validate(schema, source = "body") {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      // Report ALL validation errors, not just the first
      abortEarly: false,
      // Strip keys not declared in the schema — prevents parameter pollution
      allowUnknown: false,
      stripUnknown: true,
    });

    if (error) {
      // Flatten Joi's error details into a clean array
      const details = error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message.replace(/['"]/g, ""), // remove Joi's quote wrapping
      }));

      const err = AppError.badRequest(
        "Validation failed. Check the errors field for details.",
        "VALIDATION_ERROR",
      );
      // Attach details so the error handler can include them
      err.details = details;

      return next(err);
    }

    // Replace req[source] with the coerced, stripped value
    req[source] = value;
    next();
  };
}

module.exports = validate;
