"use strict";

const paymentService = require("../services/payment.services");
const { asyncHandler } = require("../utils/AppError");
const { sendSuccess } = require("../helpers/helper.response");
const { HTTP } = require("../constants/index");

// POST /api/v1/payments/initiate
const initiatePayment = asyncHandler(async (req, res) => {
  const { bookingId, selectedServices } = req.body;
  const userId = req.user.id;

  const result = await paymentService.initiatePayment({
    bookingId,
    userId,
    selectedServices: selectedServices || [],
  });
  return sendSuccess(res, HTTP.CREATED, "Payment initiated", result);
});

// POST /api/v1/payments/confirm
const confirmPayment = asyncHandler(async (req, res) => {
  const { bookingId, sessionId, paymentIntentId } = req.body;
  // FIX #3: was passing `paymentIntentId` but service expected `PaymentIntentId`
  // Now both sides use consistent camelCase `paymentIntentId`
  const userId = req.user.id;

  const result = await paymentService.confirmPayment({
    bookingId,
    sessionId,
    paymentIntentId, // consistent camelCase
    userId,
  });
  return sendSuccess(res, HTTP.OK, "Payment confirmed", result);
});

// POST /api/v1/payments/:bookingId/refund
const refundPayment = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { reason, amount } = req.body;
  const userId = req.user.id;

  const result = await paymentService.initiateRefund({
    bookingId,
    userId,
    reason,
    amount,
  });
  return sendSuccess(res, HTTP.OK, "Refund initiated", result);
});

// GET /api/v1/payments/:bookingId/status
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const result = await paymentService.getPaymentStatus(bookingId, userId);
  return sendSuccess(res, HTTP.OK, "Payment status retrieved", result);
});

module.exports = {
  initiatePayment,
  confirmPayment,
  refundPayment,
  getPaymentStatus,
};
