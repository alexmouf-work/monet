#!/usr/bin/env node
/**
 * Validate vercel.json against Vercel's own route parser.
 *
 * `source` patterns are path-to-regexp, not raw regex — nested groups like
 * `/(a|b-(.*).js)` are rejected — and without this check that only surfaces as a failed
 * deploy. Runs in CI (`npm run check:vercel`).
 */
import { getTransformedRoutes } from '@vercel/routing-utils';
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'vercel.json';
let config;
try {
  config = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`${file}: not readable JSON — ${err.message}`);
  process.exit(1);
}

const result = getTransformedRoutes({
  headers: config.headers,
  rewrites: config.rewrites,
  redirects: config.redirects,
  cleanUrls: config.cleanUrls,
  trailingSlash: config.trailingSlash,
});

if (result.error) {
  console.error(`${file} is invalid:`);
  for (const line of result.error.errors ?? [result.error.message]) console.error(`  ${line}`);
  if (result.error.link) console.error(`  see ${result.error.link}`);
  process.exit(1);
}

console.log(`${file}: valid — ${result.routes?.length ?? 0} route(s) compiled`);
for (const route of result.routes ?? []) {
  if (route.src) console.log(`  ${route.src} → ${Object.keys(route.headers ?? {}).join(', ')}`);
}
