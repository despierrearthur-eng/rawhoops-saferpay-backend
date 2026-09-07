// GET /api/availability
//
// Returns per-camp capacity info so the site can show / block full camps:
//   { "Herfstkamp (U12-U14)": { capacity: 20, taken: 3, remaining: 17, full: false }, ... }
//
// "taken" counts successfully PAID registrations only. Edge-cached briefly so
// repeated page loads don't each hit blob storage.

const { getAllAvailability } = require('../lib/seats');

const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://www.rawhoops.be';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', SITE_BASE_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const availability = await getAllAvailability();
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    res.status(200).json({ availability });
  } catch (err) {
    console.error('availability error:', err);
    // Fail open: an empty object means the site simply shows nothing as full,
    // rather than breaking the page. The create-payment check is the real gate.
    res.status(200).json({ availability: {} });
  }
};
