# Raw Hoops — Saferpay (Worldline) backend

Tiny backend that does the two things Saferpay requires to happen server-side
(never in the browser): starting a payment, and confirming/capturing it after
the payer finishes. Built to match the official spec exactly:

- https://docs.saferpay.com/home/integration-guide/licences-and-interfaces/payment-page
- https://saferpay.github.io/jsonapi/#Payment_v1_PaymentPage_Initialize
- https://saferpay.github.io/jsonapi/#Payment_v1_PaymentPage_Assert
- https://saferpay.github.io/jsonapi/#Payment_v1_Transaction_Capture

## How it fits together

```
/inschrijving form on rawhoops.be
        │  POST { camp, name, email }
        ▼
  /api/create-payment  ──────────────►  Saferpay PaymentPage/Initialize
        │  { redirectUrl }                     (server-side, with credentials)
        ▼
  browser redirects to redirectUrl (Saferpay-hosted payment page)
        │
        ├─ payer finishes ─► browser sent back to rawhoops.be/betaling (informational only)
        │
        └─ Saferpay calls, server-to-server (this is the one that matters):
                 /api/payment-notify?outcome=success&token=...
                        │
                        ▼
                 PaymentPage/Assert  →  if AUTHORIZED  →  Transaction/Capture
```

The browser return to `/betaling` is only ever a "thanks, check your email"
page for the visitor — it is never trusted to actually complete the payment,
since the visitor could close the tab. `/api/payment-notify` is the
authoritative step and is what Saferpay guarantees will fire.

## One-time setup (you do this part — I can't create accounts on your behalf)

1. **GitHub**: create a new empty repo (e.g. `rawhoops-saferpay-backend`), then
   from this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial Saferpay backend"
   git remote add origin <your new repo's URL>
   git push -u origin main
   ```
2. **Vercel**: go to vercel.com, sign up/log in with GitHub, click "Add New
   Project", import the repo you just pushed. Accept the defaults (it auto-
   detects the `/api` folder as serverless functions — no build config needed).
3. **Environment variables**: in the Vercel project → Settings → Environment
   Variables, add everything listed in `.env.example` with your real Saferpay
   values (from the Saferpay Backoffice). Set `SAFERPAY_ENV=test` first and
   only switch to `live` once you've tested a real end-to-end payment.
4. Redeploy after adding the env vars (Vercel does this automatically on the
   next push, or click "Redeploy" in the dashboard).

Once deployed, note the project's URL (something like
`rawhoops-saferpay-backend.vercel.app`) — that's what gets wired into the
Webflow registration form.

## Testing

Saferpay's test environment (`SAFERPAY_ENV=test`) uses test card numbers —
see https://docs.saferpay.com/home/support/testing for the current list.
Nothing is charged for real while `SAFERPAY_ENV=test`.
