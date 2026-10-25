const { z } = require('zod');
const { isValidISODate } = require('../utils/dates');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const isObjectId = v => typeof v === 'string' && OBJECT_ID.test(v);

const objectId = z.string().regex(OBJECT_ID, 'Invalid id');
const isoDate = z.string().refine(isValidISODate, 'Use a valid date in YYYY-MM-DD format');
const trimmed = (max = 120) => z.string().trim().min(1, 'Required').max(max);
const email = z.string().trim().toLowerCase().email('Enter a valid email').max(160);
const password = z.string().min(8, 'Use at least 8 characters').max(128)
  .refine(p => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');
const paise = z.number().int().min(0).max(100_000_000_00);

const pagination = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
};

module.exports = { z, objectId, isObjectId, isoDate, trimmed, email, password, paise, pagination };
