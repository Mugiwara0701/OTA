"use strict";

const config = require("./app.config");
const logger = require("./logger");

// ── Email provider abstraction ────────────────────────────────────────────────
// Currently wires SendGrid. Swap provider key to add Mailgun/SES etc.

let sgMail = null;

function getMailer() {
  if (sgMail) return sgMail;
  if (!config.email.sendgridKey) {
    logger.warn(
      "[Email] SENDGRID_API_KEY not set — emails will be logged only",
    );
    return null;
  }
  sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(config.email.sendgridKey);
  return sgMail;
}

/**
 * Send a single email.
 * Falls back to console log in development when no key is configured.
 */
async function sendEmail({ to, subject, html, text }) {
  const mailer = getMailer();

  if (!mailer) {
    logger.info(`[Email:DEV] To: ${to} | Subject: ${subject}`);
    return { messageId: "dev-noop" };
  }

  try {
    const [response] = await mailer.send({
      to,
      from: { email: config.email.fromEmail, name: config.email.fromName },
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ""),
    });
    logger.info(`[Email] Sent "${subject}" → ${to}`);
    return { messageId: response.headers["x-message-id"] };
  } catch (err) {
    logger.error(`[Email] Failed to send "${subject}" → ${to}`, {
      error: err.message,
    });
    throw err;
  }
}

module.exports = { sendEmail };
