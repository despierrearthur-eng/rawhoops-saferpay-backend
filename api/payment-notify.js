// GET/POST /api/payment-notify?outcome=success|fail&token=...
//
// Saferpay calls this URL server-to-server (SuccessNotifyUrl / FailNotifyUrl from
// PaymentPage/Initialize) after the payer finishes on the Saferpay-hosted page.
// This is the AUTHORITATIVE step — the browser redirect back to /betaling is only
// for the visitor's benefit; it must never be trusted to actually complete payment,
// since the visitor can close the tab before it fires. This webhook is what
// actually asserts the outcome and captures the funds.
//
// Per Saferpay's docs, this must call PaymentPage/Assert (never poll/guess),
// then Transaction/Capture if the assert shows an AUTHORIZED transaction.

const { assertPayment, captureTransaction } = require('../lib/saferpay');

module.exports = async (req, res) => {
  try {
    const token = req.query && req.query.token;
    if (!token) {
      console.error('payment-notify: missing token in query string', req.url);
      res.status(400).send('Missing token');
      return;
    }

    const assertResult = await assertPayment(token);
    const status = assertResult && assertResult.Transaction && assertResult.Transaction.Status;

    console.log('payment-notify: assert result', {
      token,
      status,
      transactionId: assertResult && assertResult.Transaction && assertResult.Transaction.Id,
    });

    if (status === 'AUTHORIZED') {
      const transactionId = assertResult.Transaction.Id;
      const amountValue = assertResult.Transaction.Amount.Value;
      const currencyCode = assertResult.Transaction.Amount.CurrencyCode;

      const captureResult = await captureTransaction(transactionId, amountValue, currencyCode);
      console.log('payment-notify: capture result', captureResult);
    } else if (status === 'CAPTURED') {
      // Some payment methods (e.g. certain wallets) auto-capture; nothing more to do.
      console.log('payment-notify: already captured, nothing to do');
    } else {
      // Declined, aborted, or otherwise not payable — nothing to capture.
      console.log('payment-notify: transaction not authorized, status =', status);
    }

    // Always 200 — this tells Saferpay the notification was received.
    // (If this handler throws/500s, Saferpay will retry the notification later.)
    res.status(200).send('OK');
  } catch (err) {
    console.error('payment-notify error:', err);
    res.status(500).send('Error processing notification');
  }
};
