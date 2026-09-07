// GET /api/orders   — header:  x-admin-key: <ADMIN_KEY>
//
// Lists every stored order with its payment status, for the internal
// registrations spreadsheet (a Google Apps Script polls this every ~15 min and
// joins it with the Webflow form submissions).
//
// Env vars used:
//   ADMIN_KEY               - shared secret; the request must send it as x-admin-key
//   BLOB_READ_WRITE_TOKEN   - already set (used to read the private order blobs)
//
// Response: { count, orders: [{ orderId, camp, name, email, amountEur,
//             status: "paid"|"failed"|"pending", createdAt, finalizedAt }] }
// The Saferpay token is deliberately NOT included.

const { list } = require('@vercel/blob');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    // Collect every orders/ blob (paginated).
    const blobs = [];
    let cursor;
    do {
      const page = await list({ prefix: 'orders/', limit: 1000, cursor });
      for (const b of page.blobs) blobs.push(b);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    // Fetch their contents in parallel chunks.
    const orders = [];
    const CHUNK = 25;
    for (let i = 0; i < blobs.length; i += CHUNK) {
      const slice = blobs.slice(i, i + CHUNK);
      const rows = await Promise.all(
        slice.map(async (b) => {
          try {
            const r = await fetch(b.downloadUrl || b.url, {
              headers: { Authorization: `Bearer ${blobToken}` },
            });
            if (!r.ok) return null;
            const o = await r.json();
            return {
              orderId: (b.pathname.match(/([^/]+)\.json$/) || [])[1] || null,
              camp: o.camp || null,
              name: o.name || null,
              email: o.email || null,
              amountEur: o.amountCents != null ? o.amountCents / 100 : null,
              status: o.finalStatus || 'pending',
              createdAt: o.createdAt || null,
              finalizedAt: o.finalizedAt || null,
            };
          } catch (e) {
            return null;
          }
        })
      );
      for (const row of rows) if (row) orders.push(row);
    }

    orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.status(200).json({ count: orders.length, orders });
  } catch (err) {
    console.error('orders error:', err);
    res.status(500).json({ error: err.message });
  }
};
