// POST /api/create-payment
//
// Called from the /inschrijving form on rawhoops.be after someone registers.
// Looks up the real price for the chosen camp SERVER-SIDE (never trusts a price
// sent by the browser — that would let anyone tamper with the amount), then
// calls Saferpay PaymentPage/Initialize and returns the RedirectUrl for the
// frontend to send the browser to.
//
// Expected JSON body: { camp: "Herfstkamp (U12-U14)", email: "...", name: "..." }
//
// IMPORTANT: keep CAMP_PRICES_EUR in sync with the live prices on rawhoops.be/camps.
// Prices are in whole euros here; Saferpay wants the amount in cents (smallest unit).

const { initializePayment } = require('../lib/saferpay');
const { saveOrder } = require('../lib/orders');
const { getAvailability } = require('../lib/seats');

const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://www.rawhoops.be';

// Exact camp names as used in the /inschrijving form's "Kamp" select field.
const CAMP_PRICES_EUR = {
  'Herfstkamp (U12-U14)': 169,
  'Herfstkamp (U16-U18)': 169,
  'Krokuskamp (U12-U14)': 169,
  'Krokuskamp (U16-U18)': 169,
  'NBA Big Camp (U10-U12)': 135,
  'NBA Big Camp (U14-U18)': 135,
  'Paaskamp (Maandag-Dinsdag) U10-U12': 95,
  'Paaskamp (Donderdag-Vrijdag) U12-U14': 169,
  'Paaskamp (Donderdag-Vrijdag) U16-U18': 169,
  'Elite Camp (U16-U18)': 169,
  'Elite Camp (U14)': 169,
  'Elite Camp (U12)': 169,
  'Big Camp Zomer (U10-U12)': 185,
  'Big Camp Zomer (U14-U18)': 185,
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', SITE_BASE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { camp, name, email } = req.body || {};

    if (!camp || !CAMP_PRICES_EUR.hasOwnProperty(camp)) {
      res.status(400).json({ error: `Unknown or missing camp: ${camp}` });
      return;
    }
    if (!email) {
      res.status(400).json({ error: 'Missing email' });
      return;
    }

    // Capacity gate: refuse to start a payment for a camp that is already full.
    const avail = await getAvailability(camp);
    if (avail && avail.full) {
      res.status(409).json({
        error: `${camp} is volzet. Mail hello@rawhoops.be om op de wachtlijst te komen.`,
        code: 'CAMP_FULL',
        camp,
      });
      return;
    }

    const priceEur = CAMP_PRICES_EUR[camp];
    const amountCents = Math.round(priceEur * 100);
    const orderId = `rh-${Date.now()}`;

    const forwardedFor = req.headers['x-forwarded-for'];
    const payerIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : (forwardedFor || '').split(',')[0].trim() || undefined;

    const backendBaseUrl =
      process.env.BACKEND_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

    if (!backendBaseUrl) {
      throw new Error('BACKEND_BASE_URL is not set and VERCEL_URL is unavailable');
    }

    const { redirectUrl, token, expiration } = await initializePayment({
      amountValue: amountCents,
      currencyCode: 'EUR',
      orderId,
      description: `Raw Hoops – ${camp}${name ? ` – ${name}` : ''}`,
      returnUrl: `${SITE_BASE_URL}/betaling?orderId=${encodeURIComponent(orderId)}`,
      successNotifyUrl: `${backendBaseUrl}/api/payment-notify?outcome=success&orderId=${encodeURIComponent(orderId)}`,
      failNotifyUrl: `${backendBaseUrl}/api/payment-notify?outcome=fail&orderId=${encodeURIComponent(orderId)}`,
      payerIp,
      languageCode: 'nl',
    });

    // Saferpay never sends the token back to us on its own (per the docs) —
    // we save our own orderId -> token mapping so payment-notify can look it
    // up when Saferpay calls back with just the orderId we embedded above.
    await saveOrder(orderId, {
      token,
      amountCents,
      currencyCode: 'EUR',
      camp,
      email,
      name: name || null,
      createdAt: new Date().toISOString(),
    });

    res.status(200).json({ redirectUrl, token, expiration });
  } catch (err) {
    console.error('create-payment error:', err);
    res.status(500).json({ error: 'Kon de betaling niet starten. Probeer het later opnieuw.' });
  }
};
