"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const db = require("../database/db");
const config = require("../config/app.config");
const logger = require("../config/logger");
const { encrypt } = require("../config/crypto.config");
const { AppError } = require("../utils/AppError");
const { ROLES, HTTP, ACTIVITY_LOGS } = require("../constants/index");

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
    lastName,
    phone,
    dateOfBirth,
    nationality,
    passportNumber,
  } = body;

  // PHASE 2: Do NOT auto-confirm — send verification email instead
  const { data: authData, error: authError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });

  if (authError) {
    if (
      authError.message.toLowerCase().includes("already registered") ||
      authError.message.toLowerCase().includes("already been registered")
    ) {
      throw new AppError(
        "An account with this email already exists.",
        HTTP.CONFLICT,
      );
    }
    throw new AppError(
      "Registration failed. Please try again later.",
      HTTP.INTERNAL_ERROR,
    );
  }

  const authUserId = authData.user.id;

  let userProfile;
  try {
    // PHASE 2: Encrypt PII before storing in DB
    userProfile = await db.insert("users", {
      auth_user_id: authUserId,
      email,
      first_name: firstName,
      last_name: lastName,
      phone,
      date_of_birth: dateOfBirth,
      nationality,
      passport_number: encrypt(passportNumber), // ← encrypted at rest
      is_active: true,
    });
  } catch (err) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (deleteErr) {
      logger.warn("Failed to delete auth user", deleteErr);
    }
    throw err;
  }

  const customerRole = await db.findOne("roles", { name: ROLES.CUSTOMER });
  if (customerRole) {
    await db.insert("user_roles", {
      user_id: userProfile.id,
      role_id: customerRole.id,
    });
  }

  // PHASE 3: Send email verification
  const verifyToken = crypto.randomBytes(32).toString("hex");
  const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const hashedVerifyToken = crypto
    .createHash("sha256")
    .update(verifyToken)
    .digest("hex");
  try {
    await supabaseAdmin.from("email_verification_tokens").insert({
      user_id: userProfile.id,
      token: hashedVerifyToken,
      expires_at: verifyExpiry,
    });
  } catch (err) {
    logger.warn("Failed to store email verification token", err);
  }

  const emailService = require("./email.services");
  emailService
    .sendEmailVerification({
      email,
      firstName,
      verifyToken,
    })
    .catch(() => {});

  const token = generateAccessToken(userProfile, [ROLES.CUSTOMER]);
  const refreshToken = generateRefreshToken(userProfile.id);

  try {
    await db.insert("activity_logs", {
      user_id: userProfile.id,
      action: ACTIVITY_LOGS.USER_REGISTERED,
      entity_type: "user",
      entity_id: userProfile.id,
      ip_address: ipAddress,
      meta_data: { email },
    });
  } catch (err) {
    logger.warn("Failed to log activity", err);
  }

  logger.info(`[Auth] New user registered`, { userId: userProfile.id, email });

  return {
    user: sanitizeUser(userProfile),
    roles: [ROLES.CUSTOMER],
    token,
    refreshToken,
  };
}

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
async function verifyEmail(token) {
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const { data: record, error } = await supabaseAdmin
    .from("email_verification_tokens")
    .select("*")
    .eq("token", hashedToken)
    .single();

  if (error || !record)
    throw new AppError(
      "Invalid or expired verification token.",
      HTTP.BAD_REQUEST,
    );
  if (new Date(record.expires_at) < new Date()) {
    throw new AppError(
      "Verification token has expired. Please request a new one.",
      HTTP.BAD_REQUEST,
    );
  }
  if (record.used_at)
    throw new AppError("Token already used.", HTTP.BAD_REQUEST);

  await supabaseAdmin.auth.admin.updateUserById(
    (
      await supabaseAdmin
        .from("users")
        .select("auth_user_id")
        .eq("id", record.user_id)
        .single()
    ).data.auth_user_id,
    { email_confirm: true },
  );

  await supabaseAdmin
    .from("email_verification_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", record.id);

  return { verified: true };
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

  if (!authData.user.email_confirmed_at) {
    throw new AppError(
      "Please verify your email before logging in.",
      HTTP.FORBIDDEN,
    );
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

  try {
    await supabaseAdmin.from("refresh_tokens").insert({
      user_id: userProfile.id,
      token_hash: crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex"),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    logger.warn("Failed to store refresh token", err);
  }

  // Log activity
  try {
    await db.insert("activity_logs", {
      user_id: userProfile.id,
      action: ACTIVITY_LOGS.USER_LOGGED_IN,
      entity_type: "user",
      entity_id: userProfile.id,
      id_address: ip_address,
      meta_data: { email },
    });
  } catch (err) {
    logger.warn("Failed to log activity", err);
  }

  logger.info(`[Auth] User logged in`, { userId: userProfile.id, email });

  return {
    user: sanitizeUser(userProfile),
    roles,
    token,
    refreshToken,
  };
}

// ── LOGOUT (revoke refresh token) ─────────────────────────────────────────────
async function logout(refreshToken) {
  if (!refreshToken) return;
  const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
  try {
    await supabaseAdmin
      .from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash);
  } catch (err) {
    logger.warn("Failed to revoke refresh token", err);
  }
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

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: stored } = await supabaseAdmin
    .from("refresh_tokens")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!stored || stored.revoked_at) {
    throw new AppError(
      "Refresh token has been revoked. Please login again",
      HTTP.UNAUTHORIZED,
    );
  }

  const userProfile = await db.findOne(
    "users",
    { id: payload.sub },
    { throwIfNotFound: true },
  );

  const roles = await loadUserRole(userProfile.id);
  const newToken = generateAccessToken(userProfile, roles);
  const newRefreshToken = generateRefreshToken(userProfile.id);

  // Rotate: revoke old, store new
  try {
    await supabaseAdmin
      .from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash);
  } catch (err) {
    logger.warn("Failed to revoke old refresh token", err);
  }

  try {
    await supabaseAdmin.from("refresh_tokens").insert({
      user_id: userProfile.id,
      token_hash: crypto
        .createHash("sha256")
        .update(newRefreshToken)
        .digest("hex"),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    logger.warn("Failed to store new refresh token", err);
  }

  return { token: newToken, refreshToken: newRefreshToken };
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
async function forgotPassword(email) {
  const userProfile = await db.findOne("users", { email });
  if (!userProfile) return { send: true };

  const resetToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

  await supabaseAdmin
    .from("password_reset_tokens")
    .upsert(
      {
        user_id: userProfile.id,
        token_hash: crypto
          .createHash("sha256")
          .update(resetToken)
          .digest("hex"),
        expires_at: expiresAt,
        used_at: null,
      },
      { onConflict: "user_id" },
    )
    .catch(() => {});

  const emailService = require("./email.services");
  await emailService.sendPasswordReset({
    email,
    firstName: userProfile.first_name,
    resetToken,
  });

  logger.info(`[Auth] Password reset email sent`, { userId: userProfile.id });
  return { sent: true };
}

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
async function resetPassword(token, newPassword) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: record } = await supabaseAdmin
    .from("password_reset_tokens")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!record)
    throw new AppError("Invalid or expired reset token.", HTTP.BAD_REQUEST);
  if (new Date(record.expires_at) < new Date()) {
    throw new AppError(
      "Reset token has expired. Please request a new one.",
      HTTP.BAD_REQUEST,
    );
  }
  if (record.used_at)
    throw new AppError("Token already used.", HTTP.BAD_REQUEST);
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("auth_user_id")
    .eq("id", record.user_id)
    .single();
  await supabaseAdmin.auth.admin.updateUserById(user.auth_user_id, {
    password: newPassword,
  });

  // Mark the reset token as consumed
  await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", record.id)
    .catch(() => {});

  // Revoke all active refresh tokens for this user
  await supabaseAdmin
    .from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", record.user_id)
    .is("revoked_at", null)
    .catch(() => {});

  logger.info(`[Auth] Password reset completed`, { userId: record.user_id });
  return { reset: true };
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
  if (body.firstName) payload.first_name = body.firstName;
  if (body.lastName) payload.last_name = body.lastName;
  if (body.phone) payload.phone = body.phone;
  if (body.dateOfBirth) payload.date_of_birth = body.dateOfBirth;
  if (body.nationality) payload.nationality = body.nationality;
  if (body.passportNumber)
    payload.passport_number = encrypt(body.passportNumber);

  if (Object.keys(payload).length === 0) {
    throw new AppError("No valid field provided for update.", HTTP.BAD_REQUEST);
  }
  const updated = await db.update("users", { id: userId }, payload);
  return sanitizeUser(updated[0]);
}

module.exports = {
  register,
  verifyEmail,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
};
