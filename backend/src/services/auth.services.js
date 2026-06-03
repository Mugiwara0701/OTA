"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { supabaseAdmin } = require("../config/supabase");
const db = require("../database/db");
const config = require("../config/app.config");
const logger = require("../config/logger");
const { encrypt, decrypt } = require("../config/crypto.config");
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
  const { auth_user_id, passport_number, ...safe } = user;
  // Decrypt passport so the frontend always receives the plaintext value.
  // The encrypted blob is never sent to the client.
  if (passport_number) {
    safe.passport_number = decrypt(passport_number) ?? null;
  }
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

  // Store refresh token so /auth/refresh works immediately after registration
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
    logger.warn("Failed to store refresh token on register", err);
  }

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

  // Sign out of the Supabase Auth session — we use our own JWT system,
  // so we don't need Supabase's session. Leaving it open causes auth.refresh_tokens
  // to accumulate and can interfere with our public.refresh_tokens inserts.
  try {
    await supabaseAdmin.auth.signOut();
  } catch (_) {}

  // Revoke any existing active tokens for this user first
  const { error: revokeError } = await supabaseAdmin
    .from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userProfile.id)
    .is("revoked_at", null);

  if (revokeError) {
    logger.warn("Failed to revoke old refresh tokens on login", revokeError);
  }

  // Insert new refresh token — log the full error if it fails so we can debug
  const { error: insertError } = await supabaseAdmin
    .from("refresh_tokens")
    .insert({
      user_id: userProfile.id,
      token_hash: crypto
        .createHash("sha256")
        .update(refreshToken)
        .digest("hex"),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

  if (insertError) {
    logger.error("[Auth] CRITICAL — failed to store refresh token on login", {
      error: insertError.message,
      code: insertError.code,
      details: insertError.details,
      hint: insertError.hint,
      userId: userProfile.id,
    });
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

  if (!stored) {
    throw new AppError(
      "Refresh token not found. Please login again",
      HTTP.UNAUTHORIZED,
    );
  }
  if (stored.revoked_at) {
    // Grace window: if this token was rotated very recently (within 30 seconds),
    // a concurrent request may have already refreshed it. Look up the newest
    // active token for this user and return that instead of forcing a re-login.
    const revokedAt = new Date(stored.revoked_at);
    const secondsSinceRevoke = (Date.now() - revokedAt.getTime()) / 1000;

    if (secondsSinceRevoke <= 30) {
      const { data: latest } = await supabaseAdmin
        .from("refresh_tokens")
        .select("*")
        .eq("user_id", stored.user_id)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest) {
        // Return a fresh access token using the already-rotated refresh token
        const userProfile = await db.findOne(
          "users",
          { id: stored.user_id },
          { throwIfNotFound: true },
        );
        const roles = await loadUserRole(userProfile.id);
        const newToken = generateAccessToken(userProfile, roles);
        logger.info(
          "[Auth] Concurrent refresh detected — reusing rotated token",
          {
            userId: stored.user_id,
            secondsSinceRevoke,
          },
        );
        return { token: newToken, refreshToken: null }; // null = Flutter keeps its current refresh token
      }
    }

    throw new AppError(
      "Refresh token has been revoked. Please login again",
      HTTP.UNAUTHORIZED,
    );
  }

  // Check DB-level expiry as a safety net
  if (stored.expires_at && new Date(stored.expires_at) < new Date()) {
    throw new AppError(
      "Refresh token has expired. Please login again",
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

  // Rotate: revoke old, insert new (both in parallel for speed)
  await Promise.all([
    supabaseAdmin
      .from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hash)
      .then(({ error }) => {
        if (error) logger.warn("Failed to revoke old refresh token", error);
      }),
    supabaseAdmin
      .from("refresh_tokens")
      .insert({
        user_id: userProfile.id,
        token_hash: crypto
          .createHash("sha256")
          .update(newRefreshToken)
          .digest("hex"),
        expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .then(({ error }) => {
        if (error) logger.warn("Failed to store new refresh token", error);
      }),
  ]);

  return { token: newToken, refreshToken: newRefreshToken };
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
async function forgotPassword(email) {
  const userProfile = await db.findOne("users", { email });
  if (!userProfile) return { send: true };

  const resetToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const tokenHash = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  const { error: upsertError } = await supabaseAdmin
    .from("password_reset_tokens")
    .upsert(
      {
        user_id: userProfile.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        used_at: null,
      },
      { onConflict: "user_id" },
    );

  if (upsertError) {
    logger.warn("Failed to upsert password reset token", upsertError);
  }

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
  const cleanToken = decodeURIComponent(token).trim();
  const hash = crypto.createHash("sha256").update(cleanToken).digest("hex");
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
  const { error: markUsedError } = await supabaseAdmin
    .from("password_reset_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", record.id);
  if (markUsedError)
    logger.warn("Failed to mark reset token as used", markUsedError);

  // Revoke all active refresh tokens for this user
  const { error: revokeError } = await supabaseAdmin
    .from("refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", record.user_id)
    .is("revoked_at", null);
  if (revokeError)
    logger.warn("Failed to revoke refresh tokens after reset", revokeError);

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

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────
// Authenticated user supplies currentPassword + newPassword.
// We re-verify the current password via Supabase signInWithPassword before
// updating, so the user can't just swap a password with a stolen access token.
async function changePassword(userId, currentPassword, newPassword) {
  // 1. Load the user's profile to get their email
  const userProfile = await db.findOne(
    "users",
    { id: userId },
    { throwIfNotFound: true },
  );

  // 2. Re-authenticate with the current password to confirm identity
  const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
    email: userProfile.email,
    password: currentPassword,
  });

  if (signInError) {
    throw new AppError("Current password is incorrect.", HTTP.BAD_REQUEST);
  }

  // 3. Update the password in Supabase Auth
  await supabaseAdmin.auth.admin.updateUserById(userProfile.auth_user_id, {
    password: newPassword,
  });

  // 4. Revoke all existing refresh tokens so other sessions are invalidated
  try {
    await supabaseAdmin
      .from("refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);
  } catch (err) {
    logger.warn("Failed to revoke refresh tokens on password change", err);
  }

  // 5. Log the activity
  try {
    await db.insert("activity_logs", {
      user_id: userId,
      action: ACTIVITY_LOGS.USER_LOGGED_IN, // closest available constant
      entity_type: "user",
      entity_id: userId,
      meta_data: { event: "password_changed" },
    });
  } catch (err) {
    logger.warn("Failed to log password change activity", err);
  }

  logger.info(`[Auth] Password changed`, { userId });
  return { changed: true };
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
  changePassword,
};
