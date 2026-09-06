'use strict';
/*
 * Thin nodemailer wrapper. `transport` is injectable (tests pass a fake with a `sendMail(opts)`
 * method) so nothing ever needs a real SMTP server to run. Under --insecure-dev with no SMTP host
 * configured, emails are logged to the console instead of sent, so local development never blocks
 * on real SMTP.
 */
const nodemailer = require('nodemailer');

function createEmailer({ smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, insecureDev, transport } = {}) {
  const from = smtpFrom || 'spectoflow <noreply@localhost>';
  const realTransport = transport || (smtpHost
    ? nodemailer.createTransport({ host: smtpHost, port: Number(smtpPort) || 587, auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined })
    : null);

  async function send(to, subject, html) {
    if (!realTransport) {
      if (!insecureDev) throw new Error('No SMTP transport configured (set SMTP_HOST) and --insecure-dev was not passed.');
      console.log(`[email:insecure-dev] to=${to} subject="${subject}"\n${html}`);
      return;
    }
    await realTransport.sendMail({ from, to, subject, html });
  }

  return {
    sendVerificationEmail: (to, url) => send(to, 'Verify your spectoflow email', `<p>Confirm your email address:</p><p><a href="${url}">${url}</a></p><p>This link expires in 24 hours.</p>`),
    sendPasswordResetEmail: (to, url) => send(to, 'Reset your spectoflow password', `<p>Reset your password:</p><p><a href="${url}">${url}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`),
    sendInvitationEmail: (to, projectName, url) => send(to, `You've been invited to "${projectName}" on spectoflow`, `<p>You've been invited to join <strong>${projectName}</strong>.</p><p><a href="${url}">${url}</a></p><p>This link expires in 72 hours.</p>`),
  };
}

module.exports = { createEmailer };
