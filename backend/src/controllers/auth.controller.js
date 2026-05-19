"use strict";

const authService = require("../services/auth.services");
const { sendSuccess } = require("../helpers/helper.response");
const { asyncHandler } = require("../utils/AppError");
const { HTTP } = require("../constants/index");

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

// POST /api/v1/auth/refresh
const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refreshToken(req.body.refreshToken);
  sendSuccess(res, HTTP.OK, "Token refresh successfully", result);
});

// POST /api/v1/auth/me
const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getMe(req.user.id);
  sendSuccess(res, HTTP.OK, "Profile retrieved", result);
});

// POST /api/v1/auth/me
const updateMe = asyncHandler(async (req, res) => {
  const result = await authService.updateProfile(req.user.id, req.body);
  sendSuccess(res, HTTP.OK, "Profile updated successfully", result);
});

module.exports = { register, login, refresh, getMe, updateMe };
