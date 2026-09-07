// GET /api/payment-status?orderId=rh-...
//
// Called from the /betaling page on rawhoops.be after the browser returns from
// the Saferpay-hosted payment page. Saferpay's ReturnUrl carries ONLY our own
// orderId (no outcome, no token) — so this endpoint is how /betaling finds out
// whether the payment actually went through.
//
// Two sources of truth, in order of preference:
//   1. payment-notify.js (the authoritative server-to-server webhook) writes a
//      `finalStatus` of "paid" | "failed" back onto the stored order once it has
//      asserted + captured. If that's present, we just return it.
//   2. If the webhook hasn't landed yet (the browser can beat it back), we do our
//      own PaymentPage/Assert here to get a live read, without capturing anything.
//
// Response: { status: "paid" | "failed" | "pending" | "unknown", camp?, amountCents? }
//   paid     -> registration confirmed, money authorized/captured
//   failed   -> payment cancelled or declined, nothing charged
//   pending  -> not resolved yet; the page should keep polling / show a neutral msg
//   unknown  -> no such order (e.g. someone opened /betaling directly)

const { assertPayment } = require('../lib/saferpay');
const { loadOrder } = require('../lib/orders');

const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://www.rawhoops.be';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_BASE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const orderId = req.query && req.query.orderId;
  if (!orderId) {
    res.status(400).json({ error: 'Missing orderId' });
    return;
  }

  try {
    const order = await loadOrder(orderId);

    if (!order) {
      res.status(200).json({ status: 'unknown' });
      return;
    }

    const meta = { camp: order.camp || null, amountCents: order.amountCents || null };

    // 1. Webhook already finalised this order — trust it.
    if (order.finalStatus === 'paid' || order.finalStatus === 'failed') {
      res.status(200).json({ status: order.finalStatus, ...meta });
      return;
    }

    // 2. Webhook hasn't run yet — do a live, read-only Assert.
    let assertResult;
    try {
      assertResult = await assertPayment(order.token);
    } catch (err) {
      // Token not assertable yet (payer still on the Saferpay page, or a transient
      // error). Not decisive — tell the page to keep waiting.
      console.log('payment-status: assert not ready for', orderId, '-', err.message);
      res.status(200).json({ status: 'pending', ...meta });
      return;
    }

    const status =
      assertResult && assertResult.Transaction && assertResult.Transaction.Status;

    if (status === 'AUTHORIZED' || status === 'CAPTURED') {
      res.status(200).json({ status: 'paid', ...meta });
    } else if (status === 'PENDING' || !status) {
      res.status(200).json({ status: 'pending', ...meta });
    } else {
      // FAILED / CANCELED / etc.
      res.status(200).json({ status: 'failed', ...meta });
    }
  } catch (err) {
    console.error('payment-status error:', err);
    // Never hand the page a hard error — a neutral "still processing" is safer
    // than showing a scary message for what might be a healthy payment.
    res.status(200).json({ status: 'pending' });
  }
};
