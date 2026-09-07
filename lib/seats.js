// Per-camp capacity tracking.
//
// "Taken" = number of successfully PAID registrations. Each captured payment
// writes one marker blob at seats/<camp-slug>/<orderId>.json ; the count for a
// camp is simply how many such markers exist. The markers are the source of
// truth — there is no separate counter that could drift.
//
// IMPORTANT: CAMP_CAPACITY keys must stay identical to the camp names in the
// /inschrijving form's "Kamp" dropdown and to CAMP_PRICES_EUR in create-payment.js.
//
// Limitation: a refund/cancellation done in the Saferpay Backoffice does NOT call
// this backend, so its seat marker stays and the camp shows one seat fewer than
// reality. Delete the blob seats/<camp-slug>/<orderId>.json to free that seat.
// Also, the capacity check happens when payment STARTS; in the rare case two
// people pay for the last seat within the same moment, a camp can go 1 over.

const { put, list } = require('@vercel/blob');

const CAMP_CAPACITY = {
  'Herfstkamp (U12-U14)': 20,
  'Herfstkamp (U16-U18)': 20,
  'Krokuskamp (U12-U14)': 20,
  'Krokuskamp (U16-U18)': 20,
  'NBA Big Camp (U10-U12)': 30,
  'NBA Big Camp (U14-U18)': 30,
  'Paaskamp (Maandag-Dinsdag) U10-U12': 40,
  'Paaskamp (Donderdag-Vrijdag) U12-U14': 20,
  'Paaskamp (Donderdag-Vrijdag) U16-U18': 20,
  'Elite Camp (U16-U18)': 20,
  'Elite Camp (U14)': 20,
  'Elite Camp (U12)': 20,
  'Big Camp Zomer (U10-U12)': 30,
  'Big Camp Zomer (U14-U18)': 30,
};

function slug(camp) {
  return String(camp)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Count paid markers per camp slug in a single list call.
async function countsBySlug() {
  const counts = {};
  let cursor;
  do {
    const page = await list({ prefix: 'seats/', limit: 1000, cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/^seats\/([^/]+)\//);
      if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return counts;
}

// { capacity, taken, remaining, full } for one camp, or null if unknown camp.
async function getAvailability(camp) {
  const capacity = CAMP_CAPACITY[camp];
  if (capacity == null) return null;
  const counts = await countsBySlug();
  const taken = counts[slug(camp)] || 0;
  return {
    capacity,
    taken,
    remaining: Math.max(0, capacity - taken),
    full: taken >= capacity,
  };
}

// { "<camp name>": { capacity, taken, remaining, full }, ... } for every camp.
async function getAllAvailability() {
  const counts = await countsBySlug();
  const out = {};
  for (const [camp, capacity] of Object.entries(CAMP_CAPACITY)) {
    const taken = counts[slug(camp)] || 0;
    out[camp] = {
      capacity,
      taken,
      remaining: Math.max(0, capacity - taken),
      full: taken >= capacity,
    };
  }
  return out;
}

// Record one paid seat. Keyed by orderId so a retried webhook can't double-count.
async function markSeatPaid(camp, orderId) {
  if (!camp || !orderId) return;
  await put(
    `seats/${slug(camp)}/${orderId}.json`,
    JSON.stringify({ camp, orderId, at: new Date().toISOString() }),
    {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    }
  );
}

module.exports = {
  CAMP_CAPACITY,
  slug,
  getAvailability,
  getAllAvailability,
  markSeatPaid,
};
