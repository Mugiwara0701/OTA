"use strict";

const authService = require("../services/auth.services");
const { sendSuccess } = require("../helpers/helper.response");
const { asyncHandler } = require("../utils/AppError");
const { HTTP } = require("../constants/index");
const config = require("../config/app.config"); // ✅ ADD THIS

// POST /api/v1/auth/register
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req.ip);
  sendSuccess(res, HTTP.CREATED, "Account created successfully", result);
});

// POST /api/v1/auth/login
const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req.ip);
  sendSuccess(res, HTTP.OK, "Login Successfully", result);
});

// POST /api/v1/auth/logout
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  sendSuccess(res, HTTP.OK, "Logged out successfully.");
});

// POST /api/v1/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refreshToken(req.body.refreshToken);
  sendSuccess(res, HTTP.OK, "Token refresh successfully", result);
});

// GET /api/v1/auth/verify-email?token=...
const verifyEmail = asyncHandler(async (req, res) => {
  try {
    await authService.verifyEmail(req.query.token);
    const deepLink = `${config.server.appScheme}://auth/verified?status=success`;
    return res.redirect(deepLink);
  } catch (err) {
    const deepLink = `${config.server.appScheme}://auth/verified?status=error&message=${encodeURIComponent(err.message)}`;
    return res.redirect(deepLink);
  }
});

// POST /api/v1/auth/forgot-password
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body.email);
  sendSuccess(
    res,
    HTTP.OK,
    "If that email exists, you will receive a password reset link.",
  );
});

// POST /api/v1/auth/reset-password
const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  const result = await authService.resetPassword(token, newPassword);
  sendSuccess(res, HTTP.OK, "Password reset successfully.", result);
});

// GET /api/v1/auth/me
const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user.id);
  sendSuccess(res, HTTP.OK, "Profile retrieved", result);
});

// PATCH /api/v1/auth/me
const updateMe = asyncHandler(async (req, res) => {
  const result = await authService.updateProfile(req.user.id, req.body);
  sendSuccess(res, HTTP.OK, "Profile updated successfully.", result);
});

// POST /api/v1/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  sendSuccess(res, HTTP.OK, "Password changed successfully.");
});

module.exports = {
  register,
  login,
  logout,
  refresh,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getMe,
  updateMe,
  changePassword,
};
