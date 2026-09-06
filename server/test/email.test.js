'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createEmailer } = require('../src/email');

function fakeTransport() {
  const sent = [];
  return { sent, sendMail: async (opts) => { sent.push(opts); return { messageId: 'fake' }; } };
}

test('sendVerificationEmail/sendPasswordResetEmail/sendInvitationEmail each send exactly one message with the link included', async () => {
  const transport = fakeTransport();
  const emailer = createEmailer({ smtpFrom: 'spectoflow <noreply@example.com>', transport });
  await emailer.sendVerificationEmail('alice@example.com', 'https://dash.example.com/verify-email/abc123');
  await emailer.sendPasswordResetEmail('alice@example.com', 'https://dash.example.com/password-reset/xyz789');
  await emailer.sendInvitationEmail('bob@example.com', 'Alpha Project', 'https://dash.example.com/invitations/qqq111');
  assert.strictEqual(transport.sent.length, 3);
  assert.strictEqual(transport.sent[0].to, 'alice@example.com');
  assert.match(transport.sent[0].html, /abc123/);
  assert.match(transport.sent[1].html, /xyz789/);
  assert.match(transport.sent[2].html, /qqq111/);
  assert.match(transport.sent[2].html, /Alpha Project/);
  assert.strictEqual(transport.sent[0].from, 'spectoflow <noreply@example.com>');
});

test('sendInvitationEmail HTML-escapes a malicious project name (no raw HTML injected into the email body)', async () => {
  const transport = fakeTransport();
  const emailer = createEmailer({ transport });
  const malicious = '<script>alert(1)</script><a href="https://evil.example/">Click to accept</a>';
  await emailer.sendInvitationEmail('bob@example.com', malicious, 'https://dash.example.com/invitations/qqq111');
  const html = transport.sent[0].html;
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<a href="https://evil.example/">'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&lt;a href=&quot;https://evil.example/&quot;&gt;Click to accept&lt;/a&gt;'));
});

test('with insecureDev and no SMTP host configured, emails are logged to the console instead of sent', async () => {
  const emailer = createEmailer({ insecureDev: true }); // no smtpHost, no transport override
  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await emailer.sendVerificationEmail('alice@example.com', 'https://dash.example.com/verify-email/abc123');
    assert.ok(logs.some((l) => l.includes('alice@example.com') && l.includes('abc123')));
  } finally { console.log = origLog; }
});
