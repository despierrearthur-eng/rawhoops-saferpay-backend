// Tiny persistence layer bridging create-payment and payment-notify.
//
// Saferpay does NOT send the Initialize token back on its own — per the docs:
// "The notification happens via http-GET and does not carry any data (like
// the token), except parameters that have been added to the URL by the
// merchant-system." So we generate our own orderId, embed it in the
// notification URLs ourselves, and store orderId -> {token, amount, currency}
// here so payment-notify can look the token back up when Saferpay calls in.
//
// Uses Vercel Blob (private) as the store — no separate database needed.

const { put, head, del } = require('@vercel/blob');

function blobPathname(orderId) {
  return `orders/${orderId}.json`;
}

async function saveOrder(orderId, data) {
  await put(blobPathname(orderId), JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'application/json',
    allowOverwrite: true,
  });
}

async function loadOrder(orderId) {
  try {
    const info = await head(blobPathname(orderId));
    const res = await fetch(info.downloadUrl || info.url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    // A missing blob is a normal "no such order" — return null, don't throw.
    // @vercel/blob signals this as BlobNotFoundError / HTTP 404, and its message
    // reads "does not exist" (not "not found"), so check all of those.
    const msg = (err && (err.message || '')).toLowerCase();
    if (
      (err && err.name === 'BlobNotFoundError') ||
      (err && (err.status === 404 || err.statusCode === 404)) ||
      msg.includes('not found') ||
      msg.includes('does not exist')
    ) {
      return null;
    }
    throw err;
  }
}

async function deleteOrder(orderId) {
  try {
    await del(blobPathname(orderId));
  } catch (err) {
    // Non-fatal — cleanup best-effort only.
    console.error('deleteOrder: failed to delete', orderId, err.message);
  }
}

module.exports = { saveOrder, loadOrder, deleteOrder };
