// Sends the post-payment "your spot is confirmed" email via Brevo's
// transactional email API. Called from payment-notify.js once a payment has
// actually been captured.
//
// Needs one env var:
//   BREVO_API_KEY              - a Brevo (Sendinblue) API v3 key
// Optional:
//   BREVO_CONFIRM_TEMPLATE_ID  - transactional template id (defaults to 3,
//                                "Kamp bevestigd" / "Je plek is bevestigd")
//
// The template uses {{contact.KAMP}} / {{contact.FIRSTNAME}} today; we also pass
// the same values as {{params.*}} so it still renders correctly even if the
// Brevo contact record isn't there yet (or the template is switched to params).

const CONFIRM_TEMPLATE_ID = Number(process.env.BREVO_CONFIRM_TEMPLATE_ID || 3);

async function sendCampConfirmedEmail({ email, name, camp }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('brevo: BREVO_API_KEY not set — skipping confirmation email');
    return { skipped: true };
  }
  if (!email) {
    console.warn('brevo: no email on order — skipping confirmation email');
    return { skipped: true };
  }

  const firstName = (name || '').trim().split(/\s+/)[0] || '';

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      templateId: CONFIRM_TEMPLATE_ID,
      to: [{ email, name: name || undefined }],
      params: { KAMP: camp || '', FIRSTNAME: firstName },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Brevo sendTransacEmail failed (${res.status}): ${text.slice(0, 300)}`);
  }
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) {}
  return { messageId: json.messageId || null };
}

module.exports = { sendCampConfirmedEmail };
