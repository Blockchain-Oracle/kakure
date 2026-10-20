#!/usr/bin/env node
/**
 * Privacy gate for CI (audit O14, plan §2 and §6):
 *  1. The static web and docs exports load nothing from third parties. It checks resource-loading HTML
 *     attributes, CSS url(), and fetch/WebSocket/import targets in JS. Plain links (<a href>) are not
 *     loads, and doc URLs inside library error strings are not requests, so neither is flagged.
 *  2. The mobile app never asks for a push token (R5: push tokens identify devices).
 * Usage: node scripts/check-privacy.mjs <export dir>... --mobile <mobile src dir>...
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** Hosts a page may load from: our own origins and the price relay. */
const ALLOWED_LOAD_HOSTS = new Set([
  "getkakure.xyz",
  "www.getkakure.xyz",
  "docs.getkakure.xyz",
  "kakure-prices.kakure-price-relay.workers.dev",
]);

const RESOURCE_TAG = /<(script|img|source|iframe|video|audio|embed|object|link)\b[^>]*>/gi;
const LOAD_ATTRIBUTE = /\s(src|srcset|data|href)=["']([^"']+)["']/gi;
const REL_ATTRIBUTE = /\srel=["']([^"']+)["']/i;
/** <link rel> values browsers fetch on their own; anything else (canonical, alternate, author…) is not a load. */
const LOADING_REL = /(stylesheet|preload|modulepreload|prefetch|icon|manifest|preconnect|dns-prefetch)/i;
/** CSS url(), in any case; `new URL(...)` in a script builds a URL object and loads nothing, so it isn't one. */
const CSS_URL = /(?<!new\s)url\(\s*["']?(https?:\/\/[^"')\s]+)/gi;
const JS_LOAD =
  /(?:fetch\(\s*|new\s+WebSocket\(\s*|new\s+EventSource\(\s*|import\(\s*|importScripts\(\s*)["'`]((?:https?|wss?):\/\/[^"'`]+)/gi;
const PUSH_TOKEN_API = /\b(getExpoPushTokenAsync|getDevicePushTokenAsync|registerForPushNotificationsAsync)\b/;

const args = process.argv.slice(2);
const mobileAt = args.indexOf("--mobile");
const exportDirs = mobileAt === -1 ? args : args.slice(0, mobileAt);
const mobileDirs = mobileAt === -1 ? [] : args.slice(mobileAt + 1);
const problems = [];

for (const dir of exportDirs) {
  for (const file of walk(dir)) {
    const ext = extname(file);
    if (![".html", ".js", ".css", ".mjs"].includes(ext)) continue;
    const text = readFileSync(file, "utf8");
    if (ext === ".html") {
      for (const [tag, name] of text.matchAll(RESOURCE_TAG)) {
        if (name.toLowerCase() === "link" && !LOADING_REL.test(REL_ATTRIBUTE.exec(tag)?.[1] ?? "")) continue;
        for (const [, , value] of tag.matchAll(LOAD_ATTRIBUTE)) {
          for (const url of value.split(",").map((part) => part.trim().split(/\s+/)[0])) check(file, url);
        }
      }
    }
    for (const match of text.matchAll(CSS_URL)) check(file, match[1]);
    if (ext !== ".html") for (const match of text.matchAll(JS_LOAD)) check(file, match[1]);
  }
}

for (const dir of mobileDirs) {
  for (const file of walk(dir)) {
    if (![".ts", ".tsx", ".js"].includes(extname(file))) continue;
    const found = PUSH_TOKEN_API.exec(readFileSync(file, "utf8"));
    if (found) problems.push(`${file}: calls ${found[1]} (no push tokens, R5)`);
  }
}

if (problems.length > 0) {
  console.error(`Privacy gate FAILED (${problems.length}):\n${problems.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`Privacy gate passed: ${exportDirs.length} export(s), ${mobileDirs.length} mobile dir(s).`);

function check(file, url) {
  if (!/^(?:https?|wss?):\/\//i.test(url)) return; // relative, data:, blob: and fragment URLs are same-origin
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  // Library feature tests use dotless placeholder hosts (`https://x`, `https://a@b`); no real third party has one.
  if (!host.includes(".")) return;
  if (!ALLOWED_LOAD_HOSTS.has(host)) problems.push(`${file}: loads ${url}`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
