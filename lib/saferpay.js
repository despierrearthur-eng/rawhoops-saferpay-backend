// Shared helper for calling the Saferpay (Worldline) JSON API.
// Spec followed exactly as documented at:
//   https://docs.saferpay.com/home/integration-guide/licences-and-interfaces/payment-page
//   https://saferpay.github.io/jsonapi/#Payment_v1_PaymentPage_Initialize
//   https://saferpay.github.io/jsonapi/#Payment_v1_PaymentPage_Assert
//   https://saferpay.github.io/jsonapi/#Payment_v1_Transaction_Capture
//
// All required env vars (set these in the Vercel project dashboard, never in code):
//   SAFERPAY_CUSTOMER_ID   - your Saferpay Customer ID
//   SAFERPAY_TERMINAL_ID   - your Saferpay Terminal ID (8-digit numeric)
//   SAFERPAY_USERNAME      - JSON API basic-auth username (from Saferpay Backoffice > Settings > JSON API basic authentication)
//   SAFERPAY_PASSWORD      - JSON API basic-auth password
//   SAFERPAY_ENV           - "test" or "live" (defaults to "test" if unset, so you never go live by accident)

const SPEC_VERSION = '1.44';

function getApiBase() {
  const env = (process.env.SAFERPAY_ENV || 'test').toLowerCase();
  return env === 'live'
    ? 'https://www.saferpay.com/api'
    : 'https://test.saferpay.com/api';
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function authHeader() {
  const username = requireEnv('SAFERPAY_USERNAME').trim();
  const password = requireEnv('SAFERPAY_PASSWORD').trim();
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
}

function newRequestId() {
  // Any unique string is fine per spec; timestamp + random is enough here.
  return `rh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function baseRequestHeader() {
  return {
    SpecVersion: SPEC_VERSION,
    CustomerId: requireEnv('SAFERPAY_CUSTOMER_ID'),
    RequestId: newRequestId(),
    RetryIndicator: 0,
  };
}

async function callSaferpay(path, body) {
  const url = `${getApiBase()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error(`Saferpay ${path} returned non-JSON response (status ${res.status}): ${text.slice(0, 500)}`);
  }

  if (!res.ok) {
    const errName = json && json.ErrorName ? json.ErrorName : 'UnknownError';
    const errMsg = json && json.ErrorMessage ? json.ErrorMessage : text;
    throw new Error(`Saferpay ${path} failed (${res.status} ${errName}): ${errMsg}`);
  }

  return json;
}

/**
 * PaymentPage/Initialize — starts a payment, returns { token, redirectUrl, expiration }.
 *
 * @param {object} opts
 * @param {number|string} opts.amountValue - amount in the smallest currency unit (cents), e.g. 16900 for €169.00
 * @param {string} opts.currencyCode - e.g. "EUR"
 * @param {string} opts.orderId - your own reference for this order (e.g. registration id)
 * @param {string} opts.description - shown to the payer
 * @param {string} opts.returnUrl - where the browser is sent back to after payment
 * @param {string} [opts.successNotifyUrl] - server-to-server callback on success
 * @param {string} [opts.failNotifyUrl] - server-to-server callback on failure
 * @param {string} [opts.payerIp] - payer's IP address
 * @param {string} [opts.languageCode] - e.g. "nl"
 */
async function initializePayment(opts) {
  const body = {
    RequestHeader: baseRequestHeader(),
    TerminalId: requireEnv('SAFERPAY_TERMINAL_ID'),
    Payment: {
      Amount: {
        Value: String(opts.amountValue),
        CurrencyCode: opts.currencyCode,
      },
      OrderId: opts.orderId,
      Description: opts.description,
    },
    ReturnUrl: {
      Url: opts.returnUrl,
    },
    Payer: {
      ...(opts.payerIp ? { IpAddress: opts.payerIp } : {}),
      ...(opts.languageCode ? { LanguageCode: opts.languageCode } : {}),
    },
    ...(opts.successNotifyUrl || opts.failNotifyUrl
      ? {
          Notification: {
            ...(opts.successNotifyUrl ? { SuccessNotifyUrl: opts.successNotifyUrl } : {}),
            ...(opts.failNotifyUrl ? { FailNotifyUrl: opts.failNotifyUrl } : {}),
          },
        }
      : {}),
  };

  const json = await callSaferpay('/Payment/v1/PaymentPage/Initialize', body);
  return {
    token: json.Token,
    redirectUrl: json.RedirectUrl,
    expiration: json.Expiration,
  };
}

/**
 * PaymentPage/Assert — call after the payer returns, to find out what actually happened.
 * @param {string} token - the Token returned by initializePayment
 */
async function assertPayment(token) {
  const body = {
    RequestHeader: baseRequestHeader(),
    Token: token,
  };
  return callSaferpay('/Payment/v1/PaymentPage/Assert', body);
}

/**
 * Transaction/Capture — actually take the money for an AUTHORIZED transaction.
 * @param {string} transactionId - Transaction.Id from the Assert response
 * @param {number|string} amountValue - amount in smallest currency unit
 * @param {string} currencyCode - e.g. "EUR"
 */
async function captureTransaction(transactionId, amountValue, currencyCode) {
  const body = {
    RequestHeader: baseRequestHeader(),
    TransactionReference: {
      TransactionId: transactionId,
    },
    Amount: {
      Value: String(amountValue),
      CurrencyCode: currencyCode,
    },
  };
  return callSaferpay('/Payment/v1/Transaction/Capture', body);
}

module.exports = {
  initializePayment,
  assertPayment,
  captureTransaction,
};
