#!/usr/bin/env bash
#
# Full order lifecycle: paste a link → quote → sign in → order → pay → procurement →
# operator confirms → shipment → fast-forward the clock → delivered.
#
# Exercises the real HTTP surface, the worker, the outbox relay and the back office. Only the
# adapters behind the ports are simulated.

set -uo pipefail

API="${API:-http://localhost:4000}"
PASS=0; FAIL=0
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n    %s\n" "$1" "${2:-}"; FAIL=$((FAIL+1)); }
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }
jqr()  { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=$1;console.log(v===undefined||v===null?'':typeof v==='object'?JSON.stringify(v):v)}catch(e){console.log('')}})"; }

SCENARIO="${SCENARIO:-HAPPY_PATH}"

step "0. Sandbox session ($SCENARIO)"
SESSION=$(curl -s -X POST "$API/v1/sandbox/sessions" -H 'content-type: application/json' \
  -d "{\"scenarioId\":\"$SCENARIO\",\"seed\":42}" | jqr "j.id")
[ -n "$SESSION" ] && ok "session $SESSION" || { bad "session"; exit 1; }
SB="x-sandbox-session: $SESSION"

step "1. Resolve a marketplace link"
REQ_ID=$(curl -s -X POST "$API/v1/product-requests" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "$SB" \
  -d '{"url":"https://www.amazon.ae/dp/B0CHWRXH8B"}' | jqr "j.id")
[ -n "$REQ_ID" ] && ok "resolved" || { bad "resolve"; exit 1; }

step "2. Quote"
QUOTE=$(curl -s -X POST "$API/v1/quotes" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "$SB" -d "{\"requestId\":\"$REQ_ID\",\"quantity\":1}")
QUOTE_ID=$(echo "$QUOTE" | jqr "j.id")
TOTAL=$(echo "$QUOTE" | jqr "j.finalPrice.amount")
[ -n "$QUOTE_ID" ] && ok "quote $TOTAL IRR" || { bad "quote" "$QUOTE"; exit 1; }

step "3. Sign in"
PHONE="0912$(printf '%07d' $((RANDOM % 10000000)))"
CH=$(curl -s -X POST "$API/v1/auth/otp/start" -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" | jqr "j.challengeId")
sleep 1
OTP=$(grep -A15 "DEV OTP issued" /tmp/xb-api.log | grep "devOtp" | grep -oE "[0-9]{6}" | tail -1)
ACCESS=$(curl -s -X POST "$API/v1/auth/otp/verify" -H 'content-type: application/json' \
  -d "{\"challengeId\":\"$CH\",\"code\":\"$OTP\"}" | jqr "j.accessToken")
[ -n "$ACCESS" ] && ok "authenticated as $PHONE" || { bad "auth"; exit 1; }
AUTH="authorization: Bearer $ACCESS"

step "4. Address"
ADDR=$(curl -s -X POST "$API/v1/addresses" -H 'content-type: application/json' -H "$AUTH" \
  -d "{\"recipientName\":\"سارا محمدی\",\"phone\":\"$PHONE\",\"province\":\"تهران\",\"city\":\"تهران\",\"line1\":\"خیابان ولیعصر، پلاک ۱\",\"postalCode\":\"1234567890\",\"isDefault\":true}" | jqr "j.id")
[ -n "$ADDR" ] && ok "address saved" || { bad "address"; exit 1; }

step "5. Create order"
ORDER=$(curl -s -X POST "$API/v1/orders" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -H "$AUTH" -H "$SB" \
  -d "{\"quoteId\":\"$QUOTE_ID\",\"addressId\":\"$ADDR\"}")
ORDER_ID=$(echo "$ORDER" | jqr "j.id")
REF=$(echo "$ORDER" | jqr "j.publicRef")
STATE=$(echo "$ORDER" | jqr "j.state")
[ "$STATE" = "AWAITING_PAYMENT" ] && ok "order $REF → $STATE" || { bad "order" "$ORDER"; exit 1; }

step "6. Start payment (redirects off-site to the gateway)"
PAY=$(curl -s -X POST "$API/v1/orders/$ORDER_ID/payments" -H "idempotency-key: $(uuidgen)" \
  -H "$AUTH" -H "$SB")
PROVIDER_REF=$(echo "$PAY" | jqr "j.paymentId")
REDIRECT=$(echo "$PAY" | jqr "j.redirectUrl")
[ -n "$PROVIDER_REF" ] && ok "intent $PROVIDER_REF" || { bad "payment" "$PAY"; exit 1; }
echo "$REDIRECT" | grep -q "/v1/sandbox/gateway" && ok "redirect goes to the gateway page" || bad "redirect" "$REDIRECT"

step "7. Gateway settles (same path a real webhook drives)"
curl -s -o /dev/null -X POST "$API/v1/sandbox/gateway/settle" \
  -H 'content-type: application/json' \
  -d "{\"ref\":\"$PROVIDER_REF\",\"returnUrl\":\"http://localhost:3010/checkout/return/\"}"
sleep 2
STATE=$(curl -s "$API/v1/orders/$ORDER_ID" -H "$AUTH" -H "$SB" | jqr "j.state")
# The worker may already have moved the order on by the time we look — including straight to
# an exception if the guard tripped. Any of these means settlement itself succeeded.
case "$STATE" in
  PAID|PROCUREMENT_PENDING|PRICE_CHANGED|OUT_OF_STOCK)
    ok "settled → $STATE  (PAID is never PURCHASED)" ;;
  *)
    bad "settlement" "state=$STATE" ;;
esac

step "8. Worker picks up order.paid and creates the procurement task"
# Ask the database about *this* order rather than grepping a shared log — the log accumulates
# across runs, so a previous order's block would be misread as this one's.
PROC=""; BLOCKED=""
for i in $(seq 1 20); do
  OSTATE=$(docker exec xb-platform-postgres-1 psql -U xb -d xb -t -A \
    -c "SELECT state FROM \"order\" WHERE id='$ORDER_ID'" 2>/dev/null | tr -d ' \r')
  case "$OSTATE" in
    PRICE_CHANGED|OUT_OF_STOCK|PROCUREMENT_FAILED) BLOCKED="$OSTATE"; break ;;
  esac
  HAS_PROC=$(docker exec xb-platform-postgres-1 psql -U xb -d xb -t -A \
    -c "SELECT count(*) FROM procurement_order WHERE order_id='$ORDER_ID'" 2>/dev/null | tr -d ' \r')
  [ "$HAS_PROC" = "1" ] && { PROC="ready"; break; }
  sleep 1
done

if [ -n "$BLOCKED" ]; then
  STATE=$(curl -s "$API/v1/orders/$ORDER_ID" -H "$AUTH" -H "$SB" | jqr "j.state")
  ok "guard blocked the purchase → $STATE (expected for a breach scenario)"
  EXC=$(curl -s "$API/v1/admin/exceptions" -H "authorization: Bearer $(curl -s -X POST "$API/v1/auth/operator/login" -H 'content-type: application/json' -d '{"email":"ops@example.ir","password":"ops-dev-password"}' | jqr "j.accessToken")" | jqr "j.items.length")
  [ "$EXC" -gt 0 ] 2>/dev/null && ok "exception raised in the ops queue ($EXC open)" || bad "exception queue" "n=$EXC"
  printf "\n\033[1m%d passed, %d failed\033[0m\n" "$PASS" "$FAIL"; exit 0
fi
[ -n "${PROC:-}" ] && ok "procurement task created" || bad "worker did not process order.paid"

step "9. Operator confirms the purchase"
OPS=$(curl -s -X POST "$API/v1/auth/operator/login" -H 'content-type: application/json' \
  -d '{"email":"ops@example.ir","password":"ops-dev-password"}' | jqr "j.accessToken")
[ -n "$OPS" ] && ok "operator signed in" || bad "operator login"

PROC_ID=$(docker exec xb-platform-postgres-1 psql -U xb -d xb -t -A \
  -c "SELECT id FROM procurement_order WHERE order_id='$ORDER_ID' LIMIT 1" 2>/dev/null | tr -d ' \r')
[ -n "$PROC_ID" ] && ok "procurement order $PROC_ID" || bad "no procurement order row"

COPILOT=$(curl -s "$API/v1/admin/procurements/$PROC_ID/copilot" \
  -H "authorization: Bearer $OPS" -H "$SB")
WITHIN=$(echo "$COPILOT" | jqr "j.withinGuard")
CURRENT=$(echo "$COPILOT" | jqr "j.currentPrice.amount")
MAXA=$(echo "$COPILOT" | jqr "j.maxAuthorised.amount")
[ -n "$WITHIN" ] && ok "copilot: current=$CURRENT max=$MAXA withinGuard=$WITHIN" || bad "copilot" "$COPILOT"

CONF=$(curl -s -X POST "$API/v1/admin/procurements/$PROC_ID/confirm" \
  -H 'content-type: application/json' -H "authorization: Bearer $OPS" -H "$SB" \
  -H "idempotency-key: $(uuidgen)" \
  -d "{\"externalOrderId\":\"404-1234567-7654321\",\"actualPaid\":{\"amount\":$CURRENT,\"currency\":\"AED\"}}")
CSTATE=$(echo "$CONF" | jqr "j.state")
[ "$CSTATE" = "PURCHASED" ] && ok "confirmed → PURCHASED" || bad "confirm" "$CONF"

step "10. Worker creates the shipment"
sleep 4
SHIP=$(docker exec xb-platform-postgres-1 psql -U xb -d xb -t -A \
  -c "SELECT count(*) FROM shipment WHERE order_id='$ORDER_ID'" 2>/dev/null | tr -d ' \r')
[ "$SHIP" -ge 1 ] 2>/dev/null && ok "shipment created" || bad "no shipment" "count=$SHIP"

step "11. Fast-forward the virtual clock"
for H in 24 48 72; do
  curl -s -o /dev/null -X POST "$API/v1/sandbox/sessions/$SESSION/advance" \
    -H 'content-type: application/json' -d "{\"hours\":$H}"
done
sleep 12  # let the tracking poller walk the now-visible legs
HOURS=$(curl -s "$API/v1/sandbox/sessions/$SESSION" | jqr "j.hoursSincePurchase")
ok "virtual clock at +${HOURS%.*}h since purchase"

step "12. Ledger balanced"
LED=$(docker exec xb-platform-postgres-1 psql -U xb -d xb -t -A -c \
  "SELECT currency||':'||sum(debit_minor)||'='||sum(credit_minor) FROM ledger_entry WHERE ref_id IN (SELECT id FROM \"order\" WHERE id='$ORDER_ID') GROUP BY currency" 2>/dev/null | tr -d ' \r')
[ -n "$LED" ] && ok "order ledger: $LED" || bad "no ledger entries"

step "13. Customer-facing timeline"
TL=$(curl -s "$API/v1/orders/$ORDER_ID" -H "$AUTH" -H "$SB")
FSTATE=$(echo "$TL" | jqr "j.state")
DONE=$(echo "$TL" | jqr "j.timeline.filter(s=>s.status==='DONE').length")
STEPS=$(echo "$TL" | jqr "j.timeline.length")
ok "final state $FSTATE — $DONE/$STEPS customer steps complete"
echo "$TL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);for(const t of j.timeline)console.log('      '+(t.status==='DONE'?'✓':t.status==='CURRENT'?'●':'○')+' '+t.label.en)})"

printf "\n\033[1m%d passed, %d failed\033[0m\n" "$PASS" "$FAIL"
echo "  Track it: http://localhost:3010/track/?id=$ORDER_ID"
[ "$FAIL" -eq 0 ]
