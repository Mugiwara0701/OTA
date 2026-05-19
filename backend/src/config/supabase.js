"use strict";

const { createClient } = require("@supabase/supabase-js");
const config = require("./app.config");
const logger = require("./logger");

// ── PUBLIC CLIENT  ─────────────────────────────────────────────────────────────────
const supabaseClient = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
    },
  },
);

// ── ADMIN CLIENT  ─────────────────────────────────────────────────────────────────
const supabaseAdmin = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

logger.info("[SUPABASE] client initilaized", {
  project: config.supabase.url,
});

module.exports = { supabaseClient, supabaseAdmin };
