// GET/POST /api/payment-notify?outcome=success|fail&orderId=...
//
// Saferpay calls this URL server-to-server (SuccessNotifyUrl / FailNotifyUrl from
// PaymentPage/Initialize) after the payer finishes on the Saferpay-hosted page.
// This is the AUTHORITATIVE step — the browser redirect back to /betaling is only
// for the visitor's benefit; it must never be trusted to actually complete payment,
// since the visitor can close the tab before it fires. This webhook is what
// actually asserts the outcome and captures the funds.
//
// IMPORTANT: Saferpay does NOT send the Initialize token back to us on its own —
// per the docs, the notification "does not carry any data (like the token), except
// parameters that have been added to the URL by the merchant-system". So we embed
// our own orderId in the notify URL (see create-payment.js) and look the token
// back up from where we stored it.

const { assertPayment, captureTransaction } = require('../lib/saferpay');
const { loadOrder, saveOrder } = require('../lib/orders');
const { sendCampConfirmedEmail } = require('../lib/brevo');
const { markSeatPaid } = require('../lib/seats');

module.exports = async (req, res) => {
  try {
    const orderId = req.query && req.query.orderId;
    if (!orderId) {
      console.error('payment-notify: missing orderId in query string', req.url);
      res.status(400).send('Missing orderId');
      return;
    }

    const order = await loadOrder(orderId);
    if (!order) {
      // Order genuinely not found — nothing we can do; retrying won't help.
      console.error('payment-notify: no stored order for orderId', orderId);
      res.status(200).send('OK (no matching order)');
      return;
    }

    if (order.finalStatus === 'paid' || order.finalStatus === 'failed') {
      // Already resolved by an earlier notification — don't re-Assert / re-Capture
      // (a second Capture on the same transaction would error and trigger endless
      // Saferpay retries). Just acknowledge.
      console.log('payment-notify: order already finalised', orderId, order.finalStatus);
      res.status(200).send('OK (already finalised)');
      return;
    }

    const assertResult = await assertPayment(order.token);
    const status = assertResult && assertResult.Transaction && assertResult.Transaction.Status;

    console.log('payment-notify: assert result', {
      orderId,
      status,
      transactionId: assertResult && assertResult.Transaction && assertResult.Transaction.Id,
    });

    let finalStatus = 'failed';

    if (status === 'AUTHORIZED') {
      const transactionId = assertResult.Transaction.Id;
      const amountValue = assertResult.Transaction.Amount.Value;
      const currencyCode = assertResult.Transaction.Amount.CurrencyCode;

      const captureResult = await captureTransaction(transactionId, amountValue, currencyCode);
      console.log('payment-notify: capture result', captureResult);
      finalStatus = 'paid';
    } else if (status === 'CAPTURED') {
      console.log('payment-notify: already captured, nothing to do');
      finalStatus = 'paid';
    } else {
      console.log('payment-notify: transaction not authorized, status =', status);
      finalStatus = 'failed';
    }

    // On a paid registration, record the seat (for per-camp capacity). Best-effort
    // and idempotent — keyed by orderId, and the finalStatus guard above stops
    // retried notifications from ever reaching here twice.
    if (finalStatus === 'paid') {
      try {
        await markSeatPaid(order.camp, orderId);
        console.log('payment-notify: seat recorded for', order.camp, orderId);
      } catch (seatErr) {
        console.error('payment-notify: markSeatPaid failed:', seatErr.message);
      }
    }

    // On a successful payment, send the "your spot is confirmed" email (Brevo
    // template 3). Best-effort: a mail failure must never fail the notification
    // or block the capture that already succeeded above. Runs once because the
    // finalStatus guard at the top short-circuits every later retry.
    let confirmationEmail = 'not-attempted';
    if (finalStatus === 'paid') {
      try {
        const r = await sendCampConfirmedEmail({
          email: order.email,
          name: order.name,
          camp: order.camp,
        });
        confirmationEmail = r && r.skipped ? 'skipped' : 'sent';
        console.log('payment-notify: confirmation email', confirmationEmail, r || '');
      } catch (mailErr) {
        confirmationEmail = 'failed';
        console.error('payment-notify: confirmation email failed:', mailErr.message);
      }
    }

    // Record the outcome back onto the stored order so /api/payment-status can
    // report it to the /betaling page. We deliberately DON'T delete the order —
    // the browser may still be on its way back and needs to read this. Stale
    // orders are tiny (~200 bytes of JSON); a periodic cleanup can be added later.
    await saveOrder(orderId, {
      ...order,
      finalStatus,
      finalizedAt: new Date().toISOString(),
      confirmationEmail,
    });

    // Always 200 — this tells Saferpay the notification was received.
    // (If this handler throws/500s, Saferpay will retry the notification later.)
    res.status(200).send('OK');
  } catch (err) {
    console.error('payment-notify error:', err);
    res.status(500).send('Error processing notification');
  }
};
