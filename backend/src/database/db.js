"use strict";

const { supabaseAdmin } = require("../config/supabase");
const { AppError } = require("../utils/AppError");
const logger = require("../config/logger");
const { HTTP } = require("../constants/index");

async function findOne(table, filter = {}, options = {}) {
  const { throwIfNotFound = false, select = "*" } = options;
  let query = supabaseAdmin.from(table).select(select);
  Object.entries(filter).forEach(([key, value]) => {
    query = query.eq(key, value);
  });
  query = query.single();

  const { data, error } = await query;

  if (error) {
    if (error.code === "PGRST116") {
      if (throwIfNotFound) {
        throw new AppError(`${table} record not found.`, HTTP.NOT_FOUND);
      }
      return null;
    }
    logger.error(`[DB] findOne error on ${table}`, {
      error: error.message,
      filter,
    });
    throw new AppError(
      `Database query failed: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return data;
}

async function findMany(table, filter = {}, options = {}) {
  const {
    select = "*",
    orderBy = "created_at",
    ascending = false,
    limit = 100,
    offset = 0,
  } = options;

  let query = supabaseAdmin.from(table).select(select, { count: "exact" });
  Object.entries(filter).forEach(([key, value]) => {
    query = query.eq(key, value);
  });
  query = query.order(orderBy, { ascending }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error(`[DB] findMany error on ${table}`, {
      error: error.message,
      filter,
    });
    throw new AppError(
      `Database query failed: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return { data: data || [], count: count || 0 };
}

async function insert(table, payload) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    logger.error(`[DB] insert error on ${table}`, { error: error.message });
    throw new AppError(
      `Failed to create new ${table} record: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return data;
}

async function update(table, filter = {}, payload = {}) {
  let query = supabaseAdmin.from(table).update(payload);
  Object.entries(filter).forEach(([key, value]) => {
    query = query.eq(key, value);
  });
  query = query.select();

  const { data, error } = await query;

  if (error) {
    logger.error(`[DB] update error on ${table}`, {
      error: error.message,
      filter,
    });
    throw new AppError(
      `Failed to update ${table} record: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return data;
}

async function remove(table, filter) {
  let query = supabaseAdmin.from(table).delete();
  Object.entries(filter).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  const { error } = await query;

  if (error) {
    logger.error(`[DB] delete error on ${table}`, { error: error.message });
    throw new AppError(
      `Failed to delete ${table} record: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return true;
}

async function rpc(functionName, params = {}) {
  const { data, error } = await supabaseAdmin.rpc(functionName, params);

  if (error) {
    logger.error(`[DB] RPC error: ${functionName}`, {
      error: error.message,
      params,
    });
    throw new AppError(
      `RPC call failed: ${error.message}`,
      HTTP.INTERNAL_ERROR,
    );
  }
  return data;
}

module.exports = { findOne, findMany, insert, update, remove, rpc };
