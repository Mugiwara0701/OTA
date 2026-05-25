"use strict";

const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const db = require("../database/db");
const config = require("../config/app.config");
const logger = require("../config/logger");
const { AppError } = require("../utils/AppError");
const { ROLES, HTTP, ACTIVITY_LOGS } = require("../constants/index");
const { error, log } = require("winston");

// ───── JWT HELPER ─────────────────────────────────────────────────────────

function generateAccessToken(user, roles = []) {
  return jwt.sign(
    { sub: user.id, email: user.email, roles },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );
}

function generateRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: "refresh" }, config.jwt.secret, {
    expiresIn: config.jwt.refreshTokenExpiresIn,
  });
}

// ───── LOAD USER ROLES ─────────────────────────────────────────────────────────
async function loadUserRole(userId) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId);

  if (error) return [];
  return (data || []).map((ur) => ur.roles.name);
}

// ───── STRIPE INTERNAL FIELDS BEFORE SENDING TO CLIENT ─────────────────────────────────────────────────────────
function sanitizeUser(user) {
  const { auth_user_id, ...safe } = user;
  return safe;
}

// ── REGISTER ──────────────────────────────────────────────────────────────────
async function register(body, ipAddress) {
  const {
    email,
    password,
    firstName,
    LastName,
    phone,
    dateOfBirth,
    nationality,
    passportNumber,
  } = body;

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError) {
    if (
      authError.message.toLowerCase().includes("already registered") ||
      authError.message.toLowerCase().includes("already been registered")
    ) {
      throw new AppError(
        "An account with this email already registered",
        HTTP.CONFLICT,
      );
    }
    logger.error(`[Auth] Supabase auth user creation failed`, {
      error: authError.message,
    });
    throw new AppError(
      "Registration failed, Please try again later.",
      HTTP.INTERNAL_ERROR,
    );
  }

  const authUserId = authData.user.id;

  // Create profile in our users table
  let userProfile;
  try {
    userProfile = await db.insert("users", {
      auth_user_id: authUserId,
      email,
      first_name: firstName,
      last_name: LastName,
      phone,
      date_of_birth: dateOfBirth,
      nationality,
      passport_number: passportNumber,
    });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    throw err;
  }

  // Assign default CUSTOMER role
  const customerRole = await db.findOne("roles", { name: ROLES.CUSTOMER });
  if (customerRole) {
    await db.insert("user_roles", {
      user_id: userProfile.id,
      role_id: customerRole.id,
    });
  }

  // Generate tokens
  const token = generateAccessToken(userProfile, [ROLES.CUSTOMER]);
  const refreshToken = generateRefreshToken(userProfile.id);

  // Log activity
  await db
    .insert("activity_logs", {
      user_id: userProfile.id,
      action: ACTIVITY_LOGS.USER_REGISTERED,
      entity_type: "user",
      entity_id: userProfile.id,
      ip_address: ipAddress,
      metadata: { email },
    })
    .catch(() => {});

  logger.info(`[Auth] new user registered`, { userId: userProfile, email });

  return {
    user: sanitizeUser(userProfile),
    roles: [ROLES.CUSTOMER],
    token,
    refreshToken,
  };
}

// ── LOGIN ──────────────────────────────────────────────────────────────────

async function login({ email, password }, ip_address) {
  // Supabase Auth verifies password
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

  if (authError) {
    throw new AppError("Invalid email or password", HTTP.UNAUTHORIZED);
  }

  // Load our users profile
  const userProfile = await db.findOne(
    "users",
    {
      auth_user_id: authData.user.id,
    },
    { throwIfNotFound: true },
  );

  if (!userProfile.is_active) {
    throw new AppError(
      "Your account has been deactivated please contact to support",
      HTTP.FORBIDDEN,
    );
  }

  // Load roles
  const roles = await loadUserRole(userProfile.id);

  // Generate tokens
  const token = generateAccessToken(userProfile, roles);
  const refreshToken = generateRefreshToken(userProfile.id);

  // Log activity
  await db
    .insert("activity_logs", {
      user_id: userProfile.id,
      action: ACTIVITY_LOGS.USER_LOGGED_IN,
      entity_type: "user",
      entity_id: userProfile.id,
      ip_address: ipAddress,
      metadata: { email },
    })
    .catch(() => {});

  logger.info(`[Auth] User logged in`, { userId: userProfile.id, email });

  return {
    user: sanitizeUser(userProfile),
    roles,
    token,
    refreshToken,
  };
}

// ── REFRESH TOKEN ─────────────────────────────────────────────────────────────
async function refreshToken(token) {
  if (!token) {
    throw new AppError("Refresh token is expired", HTTP.BAD_REQUEST);
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw new AppError("Invalid or expired refresh token", HTTP.UNAUTHORIZED);
  }

  if (payload.type !== "refresh") {
    throw new AppError("Invalid token type", HTTP.UNAUTHORIZED);
  }

  const userProfile = await db.findOne(
    "users",
    { id: payload.sub },
    { throwIfNotFound: true },
  );

  const roles = await loadUserRole(userProfile.id);
  const newToken = generateAccessToken(userProfile, roles);
  const newRefreshToken = generateRefreshToken(userProfile.id);

  return { token: newToken, refreshToken: newRefreshToken };
}

// ── GET CURRENT LOGGED IN USER PROFILE ─────────────────────────────────────────────────────────────
async function getMe(userId) {
  const userProfile = await db.findOne(
    "users",
    { id: userId },
    { throwIfNotFound: true },
  );

  const roles = await loadUserRole(userId);

  return {
    user: sanitizeUser(userProfile),
    roles,
  };
}

// ── UPDATE PROFILE ─────────────────────────────────────────────────────────────

async function updateProfile(userId, body) {
  const payload = {};
  if (body.firstName) payload.firstName = body.firstName;
  if (body.LastName) payload.LastName = body.LastName;
  if (body.phone) payload.phone = body.phone;
  if (body.dataOfBirth) payload.data_of_birth = body.dateOfBirth;
  if (body.nationality) payload.nationality = body.nationality;
  if (body.passportNumber) payload.passport_number = body.passportNumber;

  if (Object.keys(payload).length === 0) {
    throw new AppError("No valid field provided for update.", HTTP.BAD_REQUEST);
  }
  const updated = await db.update("users", { id: userId }, payload);
  return sanitizeUser(updated[0]);
}

module.exports = { register, login, refreshToken, getMe, updateProfile };
