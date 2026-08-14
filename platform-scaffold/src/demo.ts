// End-to-end demo — drives the whole flow through the core and prints the lifecycle.
// Run:  npm run demo      (or: node --experimental-strip-types src/demo.ts)

import { buildApp } from './app.ts';
import { formatMoney } from './shared/kernel.ts';

function hr(t: string) { console.log('\n' + '─'.repeat(64) + '\n' + t); }

async function happyPath() {
  hr('SCENARIO 1 — HAPPY PATH (resolve → quote → pay → procure → deliver)');
  const app = buildApp();
  app.bus.on('*', (e) => console.log(`   event: ${e.type}`, JSON.stringify(e.payload)));

  const url = 'https://www.amazon.ae/dp/B0CX1W2AirPodsPro2';
  console.log(`\n1) Customer pastes: ${url}`);
  const quote = await app.ordering.resolveAndQuote(url, 'CUST-1');
  console.log(`2) Quote ${quote.id}`);
  console.log(`   product: ${quote.productSnapshot.title} (${formatMoney(quote.productSnapshot.price)})`);
  console.log(`   final:   ${formatMoney(quote.finalPrice)}  | overhead ${(quote.overheadRatio * 100).toFixed(1)}%  | viable=${quote.viable}`);
  console.log(`   maxProcurementPrice guard: ${formatMoney(quote.maxProcurementPrice)}  | TTL until ${quote.expiresAt}`);

  const order = app.ordering.createOrder(quote.id, 'CUST-1');
  console.log(`3) Order ${order.id} state=${order.state}`);

  await app.ordering.pay(order.id);
  console.log(`4) After pay -> state=${app.orders.get(order.id)!.state}  (payment != purchased)`);

  await app.ordering.procure(order.id);
  console.log(`5) After procure -> state=${app.orders.get(order.id)!.state}`);

  await app.ordering.fulfil(order.id);
  const final = app.orders.get(order.id)!;
  console.log(`6) After fulfil -> state=${final.state}`);

  console.log('\n   Unified timeline:');
  for (const t of final.timeline) console.log(`     • ${t.state}${t.note ? '  — ' + t.note : ''}`);

  console.log('\n   Ledger (deterministic, double-entry):');
  for (const l of app.ledger.all()) {
    console.log(`     ${l.account.padEnd(26)} dr ${l.debit}  cr ${l.credit}  ${l.currency}`);
  }
}

async function priceGuard() {
  hr('SCENARIO 2 — PRICE GUARD (marketplace price jumps above tolerance)');
  const app = buildApp({ procurementPriceOverride: 940 }); // expected 899, max ~917 -> should trip guard
  const quote = await app.ordering.resolveAndQuote('https://www.amazon.ae/dp/B0CX1W2AirPodsPro2', 'CUST-2');
  const order = app.ordering.createOrder(quote.id, 'CUST-2');
  await app.ordering.pay(order.id);
  await app.ordering.procure(order.id);
  console.log(`   After procure attempt -> state=${app.orders.get(order.id)!.state}  (blocked: 940 > max ${order.maxProcurementPrice.amount})`);

  console.log('   Operator/customer approve reprice to new max 950 ...');
  app.ordering.approveReprice(order.id, 950);
  console.log(`   State after reprice -> ${app.orders.get(order.id)!.state}`);
  await app.ordering.procure(order.id);
  console.log(`   Re-run procurement -> state=${app.orders.get(order.id)!.state}  (now 940 <= 950, guard passes)`);
}

async function main() {
  await happyPath();
  await priceGuard();
  hr('DONE — core flow works on stub adapters. Swap adapters in app.ts as gates clear.');
}

main().catch((e) => { console.error('DEMO ERROR:', e); process.exit(1); });
