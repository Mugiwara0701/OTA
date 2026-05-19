"use strict";

function sendSuccess(
  res,
  statusCode = 200,
  message = "Success",
  data = null,
  meta = null,
) {
  const body = { success: true, message };
  if (data !== null && data !== undefined) body.data = data;
  if (meta !== null && meta !== undefined) body.meta = meta;
  return res.status(statusCode).json(body);
}

function sendError(
  res,
  statusCode = 500,
  message = "Something went wrong",
  errors = null,
) {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

function paginationMeta(page, limit, total) {
  return {
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1,
  };
}

module.exports = { sendSuccess, sendError, paginationMeta };
