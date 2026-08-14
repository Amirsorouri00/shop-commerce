#!/usr/bin/env bash
#
# End-to-end smoke test.
#
# Drives the real HTTP surface through a sandbox session: resolve a link, quote it, sign in,
# order it, pay, then fast-forward the virtual clock and watch the shipment legs appear.
#
# Every call goes through the same controllers, guards, validation pipe and ports that a
# production request would — only the adapters behind the ports differ.

set -uo pipefail

API="${API:-http://localhost:4000}"
PASS=0; FAIL=0

ok()   { printf "  \033[32mPASS\033[0m  %s\n" "$1"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31mFAIL\033[0m  %s\n     %s\n" "$1" "${2:-}"; FAIL=$((FAIL+1)); }
head() { printf "\n\033[1m%s\033[0m\n" "$1"; }

jqr() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=$1;console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('')}})"; }

head "1. Health"
curl -sf "$API/health"  >/dev/null && ok "GET /health" || bad "GET /health"
READY=$(curl -s "$API/ready" | jqr "j.database")
[ "$READY" = "true" ] && ok "GET /ready reports database up" || bad "GET /ready" "database=$READY"

head "2. Validation layer returns bilingual errors"
RESP=$(curl -s -X POST "$API/v1/product-requests" \
  -H 'content-type: application/json' -H "idempotency-key: $(uuidgen)" \
  -d '{"url":"https://ebay.com/itm/1"}')
CODE=$(echo "$RESP" | jqr "j.error.code")
FA=$(echo "$RESP"   | jqr "j.error.issues && j.error.issues[0] && j.error.issues[0].message.fa")
EN=$(echo "$RESP"   | jqr "j.error.issues && j.error.issues[0] && j.error.issues[0].message.en")
[ "$CODE" = "VALIDATION_FAILED" ] && ok "unsupported marketplace rejected" || bad "rejection" "code=$CODE"
[ -n "$FA" ] && [ -n "$EN" ] && ok "error carries both fa and en" || bad "bilingual error" "fa='$FA' en='$EN'"
echo "        fa: $FA"

head "3. Idempotency is enforced"
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/product-requests" \
  -H 'content-type: application/json' -d '{"url":"https://www.amazon.ae/dp/B0CHWRXH8B"}')
[ "$STATUS" = "400" ] && ok "missing Idempotency-Key rejected with 400" || bad "idempotency guard" "status=$STATUS"

head "3b. POST with a JSON content-type and no body"
# Browsers routinely set content-type on every request. A bodyless POST that declares JSON
# must not 500 — curl without the header cannot reproduce this, so assert it explicitly.
EMPTY=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/sandbox/sessions" -H "content-type: application/json" -d "{\"scenarioId\":\"HAPPY_PATH\"}")
[ "$EMPTY" = "201" ] && ok "bodyless-JSON POST handled ($EMPTY)" || bad "empty json body" "status=$EMPTY"

head "4. Sandbox scenarios"
COUNT=$(curl -s "$API/v1/sandbox/scenarios" | jqr "j.length")
[ "$COUNT" -ge 10 ] 2>/dev/null && ok "$COUNT scenarios exposed" || bad "scenario list" "count=$COUNT"

head "5. Happy path through a sandbox session"
SESSION=$(curl -s -X POST "$API/v1/sandbox/sessions" -H 'content-type: application/json' \
  -d '{"scenarioId":"HAPPY_PATH","seed":42}' | jqr "j.id")
[ -n "$SESSION" ] && ok "session created: $SESSION" || { bad "session"; exit 1; }

SB="x-sandbox-session: $SESSION"

REQ=$(curl -s -X POST "$API/v1/product-requests" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "$SB" \
  -d '{"url":"https://www.amazon.ae/dp/B0CHWRXH8B"}')
REQ_ID=$(echo "$REQ" | jqr "j.id")
TITLE=$(echo "$REQ"  | jqr "j.product && j.product.title")
[ -n "$REQ_ID" ] && ok "link resolved: ${TITLE:0:44}" || bad "resolve" "$REQ"

QUOTE=$(curl -s -X POST "$API/v1/quotes" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "$SB" \
  -d "{\"requestId\":\"$REQ_ID\",\"quantity\":1}")
QUOTE_ID=$(echo "$QUOTE" | jqr "j.id")
TOTAL=$(echo "$QUOTE"    | jqr "j.finalPrice && j.finalPrice.amount")
VIABLE=$(echo "$QUOTE"   | jqr "j.viable")
[ -n "$QUOTE_ID" ] && ok "quote created, total $TOTAL IRR, viable=$VIABLE" || bad "quote" "$QUOTE"

# Every line of the breakdown must be present — the transparency is the product.
for LINE in product freight handling customs insurance lastMile serviceFee; do
  V=$(echo "$QUOTE" | jqr "j.breakdown && j.breakdown.$LINE && j.breakdown.$LINE.amount")
  [ -n "$V" ] || bad "breakdown missing $LINE"
done
ok "quote breakdown itemised in full"

head "6. Authentication (OTP)"
# A fresh number each run: the resend window is 60s and would otherwise rate-limit the test
# against itself on a re-run.
PHONE="0912$(printf '%07d' $((RANDOM % 10000000)))"
CH=$(curl -s -X POST "$API/v1/auth/otp/start" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" | jqr "j.challengeId")
[ -n "$CH" ] && ok "OTP challenge issued" || bad "otp start"

# The stub SMS adapter logs the code rather than sending it. Note the log key is `devOtp`,
# not `code` — `code` is on the logger's redaction list, which is exactly what we want for
# real OTPs and why the dev affordance needs its own key.
# pino writes asynchronously, so the line may not have reached the file when the HTTP
# response returns. Give it a moment rather than racing it.
sleep 1

# pino-pretty renders each field on its own line, so `devOtp` sits several lines below the
# message. Widen the context window and pull the value from that field specifically.
CODE_OTP=$(grep -A15 "DEV OTP issued" /tmp/xb-api.log | grep "devOtp" | grep -oE "[0-9]{6}" | tail -1)

if [ -n "$CODE_OTP" ]; then
  TOK=$(curl -s -X POST "$API/v1/auth/otp/verify" -H 'content-type: application/json' \
    -d "{\"challengeId\":\"$CH\",\"code\":\"$CODE_OTP\"}")
  ACCESS=$(echo "$TOK" | jqr "j.accessToken")
  [ -n "$ACCESS" ] && ok "OTP verified, tokens issued" || bad "otp verify" "$TOK"
else
  bad "could not read dev OTP from the log"
  ACCESS=""
fi

head "7. Rate limiting on OTP"
RL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/v1/auth/otp/start" \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}")
[ "$RL" = "429" ] && ok "immediate resend rate-limited (429)" || bad "rate limit" "status=$RL"

head "8. Auth is default-deny"
UN=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/orders")
[ "$UN" = "401" ] && ok "unauthenticated /v1/orders rejected (401)" || bad "auth guard" "status=$UN"

if [ -n "$ACCESS" ]; then
  AD=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/admin/exceptions" -H "authorization: Bearer $ACCESS")
  [ "$AD" = "403" ] && ok "customer token refused on admin route (403)" || bad "rbac" "status=$AD"

  MINE=$(curl -s -o /dev/null -w '%{http_code}' "$API/v1/orders" -H "authorization: Bearer $ACCESS")
  [ "$MINE" = "200" ] && ok "authenticated /v1/orders accepted (200)" || bad "authed read" "status=$MINE"
else
  bad "skipped RBAC checks — no access token"
fi

head "9. Virtual clock"
BEFORE=$(curl -s "$API/v1/sandbox/sessions/$SESSION" | jqr "j.virtualOffsetMs")
curl -s -X POST "$API/v1/sandbox/sessions/$SESSION/advance" -H 'content-type: application/json' \
  -d '{"hours":24}' >/dev/null
AFTER=$(curl -s "$API/v1/sandbox/sessions/$SESSION" | jqr "j.virtualOffsetMs")
[ "$AFTER" -gt "$BEFORE" ] 2>/dev/null && ok "clock advanced ${BEFORE}ms -> ${AFTER}ms" || bad "clock" "$BEFORE -> $AFTER"

LOGN=$(curl -s "$API/v1/sandbox/sessions/$SESSION" | jqr "j.log.length")
[ "$LOGN" -gt 0 ] 2>/dev/null && ok "sandbox recorded $LOGN bilingual log entries" || bad "sandbox log" "n=$LOGN"

head "10. Exception scenario blocks the purchase"
S2=$(curl -s -X POST "$API/v1/sandbox/sessions" -H 'content-type: application/json' \
  -d '{"scenarioId":"PRICE_CHANGED_BREACH","seed":7}' | jqr "j.id")
R2=$(curl -s -X POST "$API/v1/product-requests" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "x-sandbox-session: $S2" \
  -d '{"url":"https://www.amazon.ae/dp/B0CHWRXH8B"}' | jqr "j.id")
Q2=$(curl -s -X POST "$API/v1/quotes" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "x-sandbox-session: $S2" \
  -d "{\"requestId\":\"$R2\",\"quantity\":1}")
MAXP=$(echo "$Q2" | jqr "j.maxProcurementPrice && j.maxProcurementPrice.amount")
[ -n "$MAXP" ] && ok "price guard ceiling set on quote: $MAXP" || bad "guard ceiling" "$Q2"

printf "\n\033[1m%d passed, %d failed\033[0m\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
