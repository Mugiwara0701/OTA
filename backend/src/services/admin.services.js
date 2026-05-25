"use strict";

const { supabaseAdmin } = require("../config/supabase");
const logger = require("../config/logger");
const { AppError } = require("../utils/AppError");
const {
  HTTP,
  BOOKINGS,
  ACTIVITY_LOGS,
  PAGINATION,
} = require("../constants/index");

// ── BOOKINGS  ─────────────────────────────────────────────────────────────
async function listAllBookings({
  status,
  bookingType,
  userId,
  dateFrom,
  dateTo,
  search,
  page = PAGINATION.DEFAULT_PAGE,
  limit = PAGINATION.DEFAULT_LIMIT,
} = {}) {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from("bookings")
    .select(
      `*, 
      users(id, email, first_name, last_name, phone),
      payments(id, status, amount, currency, payment_provider, paid_At),
      flight_booking(*),
      hotel_booking(*),
      car_booking(*)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (bookingType) query = query.eq("booking_type", bookingType);
  if (userId) query = query.eq("user_id", userId);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);
  if (search) query = query.ilike("booking_ref", `%${search}%`);

  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch bookings", HTTP.INTERNAL_ERROR, error);

  return { booking: data, total: count, page, limit };
}

async function getBookingDetail(bookingId) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select(
      `*,
      users(id, email, first_name, last_name, phone, nationality, passport_number),
      travelers(*),
      flight_booking(*),
      hotel_booking(*),
      car_booking(*),
      payments(*),
      refunds(*),
      booking_logs(* ORDER BY created_at ASC)
    `,
    )
    .throwOnError("id", bookingId)
    .single();

  if (error || !data) throw new AppError("Booking not found", HTTP.NOT_FOUND);
  return data;
}

async function updateBookingStatus(bookingId, { status, reason }, adminUserId) {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from("bookings")
    .select("id, status, booking_ref")
    .eq("id", bookingId)
    .single();

  if (fetchErr || !existing)
    throw new AppError("Booking not found", HTTP.NOT_FOUND);

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .select()
    .single();

  if (error)
    throw new AppError(
      "Failed to update booking status",
      HTTP.INTERNAL_ERROR,
      error,
    );
  await supabaseAdmin.from("booking_logs").insert({
    booking_id: bookingId,
    action: ACTIVITY_LOGS.ADMIN_ACTION,
    old_status: existing.status,
    new_status: status,
    message: reason || "Admin stats override",
    performed_by: adminUserId,
    meta_data: { admin_id: adminUserId, action: "STATUS_OVERRIDE" },
  });

  logger.info(
    `[AdminService] Booking ${existing.booking_ref} status → ${status} by admin ${adminUserId}`,
  );
  return data;
}

async function searchBookings(q) {
  const { data, error } = (
    await supabaseAdmin
      .from("bookings")
      .select(
        "*, users(email, first_name, last_name), payments(status, amount)",
      )
  )
    .error(`booking_ref.ilike.%${q}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new AppError("Search failed", HTTP.INTERNAL_ERROR, error);
  return data;
}

// ── PAYMENTS  ─────────────────────────────────────────────────────────────
async function listAllPayments({
  status,
  provider,
  dateFrom,
  dateTo,
  page = PAGINATION.DEFAULT_PAGE,
  limit = PAGINATION.DEFAULT_LIMIT,
} = {}) {
  const offset = (page - 1) * limit;
  let query = supabaseAdmin
    .from("payments")
    .select(
      "*, bookings(booking_ref, booking_type), users(email, first_name, last_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (provider) query = query.eq("payment_provider", provider);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch payments", HTTP.INTERNAL_ERROR, error);
  return { payments: data, total: count, page, limit };
}

async function getPaymentDetail(paymentId) {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select(
      "*, bookings(*, travelers(*)), users(email, first_name, last_name), refunds(*)",
    )
    .eq("id", paymentId)
    .single();

  if (error || !data) throw new AppError("Payment not found", HTTP.NOT_FOUND);
  return data;
}

// ── Users ──────────────────────────────────────────────────────────────────────

async function listAllUsers({
  search,
  isActive,
  role,
  page = PAGINATION.DEFAULT_PAGE,
  limit = PAGINATION.DEFAULT_LIMIT,
} = {}) {
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("users")
    .select("*, user_roles(roles(name))", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (isActive !== undefined)
    query = query.eq("is_active", isActive === "true" || isActive === true);
  if (search)
    query = query.or(
      `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
    );

  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch users", HTTP.INTERNAL_ERROR, error);

  // Flatten roles
  const users = (data || []).map((u) => ({
    ...u,
    roles: (u.user_roles || []).map((ur) => ur.roles?.name).filter(Boolean),
    user_roles: undefined,
  }));

  // Filter by role after fetch if specified (simpler than nested query)
  const filtered = role ? users.filter((u) => u.roles.includes(role)) : users;

  return { users: filtered, total: count, page, limit };
}

async function getUserDetail(userId) {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("*, user_roles(roles(name))")
    .eq("id", userId)
    .single();

  if (error || !user) throw new AppError("User not found", HTTP.NOT_FOUND);

  // Booking summary
  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, booking_ref, booking_type, status, total_amount, currency, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  // Booking counts by status
  const { data: allBookings } = await supabaseAdmin
    .from("bookings")
    .select("status")
    .eq("user_id", userId);

  const bookingSummary = (allBookings || []).reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  // Activity logs
  const { data: activity } = await supabaseAdmin
    .from("activity_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    ...user,
    roles: (user.user_roles || []).map((ur) => ur.roles?.name).filter(Boolean),
    user_roles: undefined,
    recentBookings: bookings || [],
    bookingSummary,
    recentActivity: activity || [],
  };
}

async function updateUserStatus(userId, isActive, adminUserId) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .update({ is_active: isActive })
    .eq("id", userId)
    .select()
    .single();

  if (error || !data) throw new AppError("User not found", HTTP.NOT_FOUND);

  await supabaseAdmin.from("activity_logs").insert({
    user_id: adminUserId,
    action: ACTIVITY_LOGS.ADMIN_ACTION,
    entity_type: "USER",
    entity_id: userId,
    meta_data: {
      action: "STATUS_UPDATED",
      is_active: isActive,
      target_user_id: userId,
    },
  });

  logger.info(
    `[AdminService] User ${userId} active=${isActive} by admin ${adminUserId}`,
  );
  return data;
}

async function assignRole(userId, roleName, adminUserId) {
  // Get role id
  const { data: role, error: roleErr } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("name", roleName)
    .single();

  if (roleErr || !role)
    throw new AppError(`Role '${roleName}' not found`, HTTP.NOT_FOUND);

  const { error } = await supabaseAdmin.from("user_roles").insert({
    user_id: userId,
    role_id: role.id,
    assigned_by: adminUserId,
  });

  if (error) {
    if (error.code === "23505")
      throw new AppError("User already has this role", HTTP.CONFLICT);
    throw new AppError("Failed to assign role", HTTP.INTERNAL_ERROR, error);
  }

  await supabaseAdmin.from("activity_logs").insert({
    user_id: adminUserId,
    action: ACTIVITY_LOGS.ADMIN_ACTION,
    entity_type: "USER",
    entity_id: userId,
    meta_data: { action: "ROLE_ASSIGNED", role: roleName },
  });

  return { userId, roleName, assigned: true };
}

async function revokeRole(userId, roleName, adminUserId) {
  const { data: role } = await supabaseAdmin
    .from("roles")
    .select("id")
    .eq("name", roleName)
    .single();
  if (!role) throw new AppError(`Role '${roleName}' not found`, HTTP.NOT_FOUND);

  const { error } = await supabaseAdmin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .eq("role_id", role.id);

  if (error)
    throw new AppError("Failed to revoke role", HTTP.INTERNAL_ERROR, error);
  return { userId, roleName, revoked: true };
}

// ── Reports / Dashboard ────────────────────────────────────────────────────────

async function getDashboardSummary({ dateFrom, dateTo } = {}) {
  const now = new Date();
  const from =
    dateFrom || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = dateTo || now.toISOString();

  const [bookingsResult, revenueResult, usersResult, routesResult] =
    await Promise.all([
      // Booking counts by status
      supabaseAdmin
        .from("bookings")
        .select("status, booking_type")
        .gte("created_at", from)
        .lte("created_at", to),

      // Revenue from confirmed bookings
      supabaseAdmin
        .from("bookings")
        .select("total_amount, currency, booking_type")
        .eq("status", "CONFIRMED")
        .gte("created_at", from)
        .lte("created_at", to),

      // New users
      supabaseAdmin
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", from)
        .lte("created_at", to),

      // Top flight routes
      supabaseAdmin
        .from("flight_booking")
        .select("origin, destination")
        .limit(200),
    ]);

  const bookings = bookingsResult.data || [];
  const revenue = revenueResult.data || [];

  // Build booking breakdown
  const byStatus = bookings.reduce((acc, b) => {
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  }, {});

  const byType = bookings.reduce((acc, b) => {
    acc[b.booking_type] = (acc[b.booking_type] || 0) + 1;
    return acc;
  }, {});

  // Revenue breakdown
  const totalRevenue = revenue.reduce(
    (sum, b) => sum + parseFloat(b.total_amount || 0),
    0,
  );
  const revenueByType = revenue.reduce((acc, b) => {
    acc[b.booking_type] =
      (acc[b.booking_type] || 0) + parseFloat(b.total_amount || 0);
    return acc;
  }, {});

  // Top routes
  const routeCount = {};
  (routesResult.data || []).forEach((fb) => {
    const key = `${fb.origin}-${fb.destination}`;
    routeCount[key] = (routeCount[key] || 0) + 1;
  });
  const topRoutes = Object.entries(routeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([route, count]) => {
      const [origin, destination] = route.split("-");
      return { origin, destination, count };
    });

  const confirmed = byStatus["CONFIRMED"] || 0;
  const total = bookings.length;

  return {
    period: { from, to },
    bookings: {
      total,
      byStatus,
      byType,
      conversionRate:
        total > 0 ? ((confirmed / total) * 100).toFixed(2) + "%" : "0%",
    },
    revenue: {
      total: totalRevenue.toFixed(2),
      byType: revenueByType,
    },
    users: {
      newThisPeriod: usersResult.count || 0,
    },
    topFlightRoutes: topRoutes,
  };
}

async function getRevenueByPeriod({ groupBy = "day", dateFrom, dateTo } = {}) {
  const now = new Date();
  const from =
    dateFrom || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const to = dateTo || now.toISOString();

  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("total_amount, currency, created_at, booking_type")
    .eq("status", "CONFIRMED")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("created_at", { ascending: true });

  if (error)
    throw new AppError(
      "Failed to fetch revenue data",
      HTTP.INTERNAL_ERROR,
      error,
    );

  // Group client-side by period
  const grouped = {};
  (data || []).forEach((b) => {
    const d = new Date(b.created_at);
    let key;
    if (groupBy === "month")
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    else if (groupBy === "week") {
      const week = Math.ceil(d.getDate() / 7);
      key = `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
    } else {
      key = d.toISOString().split("T")[0];
    }
    if (!grouped[key]) grouped[key] = { period: key, revenue: 0, bookings: 0 };
    grouped[key].revenue += parseFloat(b.total_amount || 0);
    grouped[key].bookings += 1;
  });

  return Object.values(grouped).map((g) => ({
    ...g,
    revenue: g.revenue.toFixed(2),
  }));
}

// ── Support Tickets ────────────────────────────────────────────────────────────

async function listSupportTickets({
  status,
  priority,
  assignedTo,
  page = PAGINATION.DEFAULT_PAGE,
  limit = PAGINATION.DEFAULT_LIMIT,
} = {}) {
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from("support_tickets")
    .select(
      "*, users(email, first_name, last_name), bookings(booking_ref, booking_type)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  if (assignedTo) query = query.eq("assigned_to", assignedTo);

  const { data, error, count } = await query;
  if (error)
    throw new AppError("Failed to fetch tickets", HTTP.INTERNAL_ERROR, error);
  return { tickets: data, total: count, page, limit };
}

async function getSupportTicket(ticketId) {
  const { data, error } = await supabaseAdmin
    .from("support_tickets")
    .select("*, users(email, first_name, last_name), bookings(*)")
    .eq("id", ticketId)
    .single();

  if (error || !data) throw new AppError("Ticket not found", HTTP.NOT_FOUND);
  return data;
}

async function updateSupportTicket(
  ticketId,
  { status, priority, assignedTo, resolvedAt },
  adminUserId,
) {
  const updates = {};
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  if (assignedTo) updates.assigned_to = assignedTo;
  if (status === "RESOLVED" || status === "CLOSED")
    updates.resolved_at = resolvedAt || new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("support_tickets")
    .update(updates)
    .eq("id", ticketId)
    .select()
    .single();

  if (error || !data) throw new AppError("Ticket not found", HTTP.NOT_FOUND);

  await supabaseAdmin.from("activity_logs").insert({
    user_id: adminUserId,
    action: ACTIVITY_LOGS.ADMIN_ACTION,
    entity_type: "SUPPORT_TICKET",
    entity_id: ticketId,
    meta_data: { updates },
  });

  return data;
}

module.exports = {
  listAllBookings,
  getBookingDetail,
  updateBookingStatus,
  searchBookings,
  listAllPayments,
  getPaymentDetail,
  listAllUsers,
  getUserDetail,
  updateUserStatus,
  assignRole,
  revokeRole,
  getDashboardSummary,
  getRevenueByPeriod,
  listSupportTickets,
  getSupportTicket,
  updateSupportTicket,
};
