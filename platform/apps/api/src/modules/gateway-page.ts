/**
 * The simulated payment gateway page.
 *
 * A real IRR gateway hosts its own page, takes the customer's card, then notifies us by signed
 * webhook. This stands in for that: a page the customer is genuinely redirected to, with a
 * real choice, which then drives the same `settlePayment` path a webhook would.
 *
 * It is shared by both simulated providers — the sandbox one, whose behaviour is scripted by
 * a scenario, and the development stub, which has no scenario behind it. They differ only in
 * which provider name settles the payment, so the page itself is one implementation. Without
 * it, checkout stops dead: the redirect returns to the app with nothing settled and the order
 * sits in AWAITING_PAYMENT for ever.
 */

export interface GatewayPageInput {
  /** The provider reference being settled. */
  readonly ref: string;
  /** Where to send the customer afterwards, settled or cancelled. */
  readonly returnUrl: string;
  /** Form action that performs settlement. */
  readonly settleAction: string;
  /** Human-readable amount, shown for confidence. Display only — never trusted. */
  readonly amountLabel?: string | undefined;
  /** Distinguishes the two simulated gateways in the page's own banner. */
  readonly modeLabel: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSimulatedGatewayPage(input: GatewayPageInput): string {
  const ref = escapeHtml(input.ref);
  const returnUrl = escapeHtml(input.returnUrl);
  const action = escapeHtml(input.settleAction);
  const mode = escapeHtml(input.modeLabel);
  const amount = input.amountLabel ? escapeHtml(input.amountLabel) : '';

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>درگاه پرداخت آزمایشی</title>
<style>
 body{font-family:system-ui,Tahoma,sans-serif;background:#0f1621;color:#e8eef6;display:grid;
      place-items:center;min-height:100dvh;margin:0}
 .card{background:#161f2e;border:1px solid #2b3a4f;border-radius:12px;padding:28px;max-width:380px;width:92%}
 h1{font-size:18px;margin:0 0 6px}
 p{color:#93a4bd;font-size:14px;margin:0 0 18px;line-height:1.7}
 .amount{font-size:26px;font-weight:800;color:#e8eef6;margin:0 0 4px}
 .ref{font-family:ui-monospace,monospace;font-size:12px;color:#93a4bd;direction:ltr;word-break:break-all}
 button{width:100%;font:inherit;font-weight:700;padding:12px;border-radius:8px;border:0;
        cursor:pointer;margin-top:10px}
 .pay{background:#22c55e;color:#05210f}
 .fail{background:transparent;color:#93a4bd;border:1px solid #2b3a4f}
 .tag{display:inline-block;background:#f59e0b;color:#2b1d02;font-size:11px;font-weight:700;
      padding:2px 8px;border-radius:999px;margin-bottom:12px}
</style></head>
<body>
 <div class="card">
  <span class="tag">${mode} — پرداخت واقعی انجام نمی‌شود</span>
  <h1>درگاه پرداخت</h1>
  ${amount ? `<p class="amount">${amount}</p>` : ''}
  <p>این صفحه جایگزین درگاه واقعی است. نتیجهٔ پرداخت را انتخاب کنید تا مسیر سفارش ادامه پیدا کند.</p>
  <p class="ref">${ref}</p>
  <form method="POST" action="${action}">
    <input type="hidden" name="ref" value="${ref}">
    <input type="hidden" name="returnUrl" value="${returnUrl}">
    <button class="pay" type="submit">پرداخت موفق</button>
  </form>
  <form method="GET" action="${returnUrl}">
    <button class="fail" type="submit">انصراف از پرداخت</button>
  </form>
 </div>
</body></html>`;
}
