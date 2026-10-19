/**
 * Proves the browser library (ohttp-ts + hpke) and the operator's Rust gateway (ohttp + bhttp) interoperate:
 * fetch the key config, send GET and POST /v1/ping encrypted through <relay>, read the decrypted answers.
 * Usage: pnpm --filter @kakure/ohttp roundtrip <gateway origin> [relay URL, default <gateway>/gateway]
 */
import { obliviousFetch } from "../src/index";

const [gateway, relayArg] = process.argv.slice(2);
if (!gateway) throw new Error("usage: roundtrip <gateway origin> [relay url]");
const keys = await fetch(`${gateway}/ohttp-keys`);
const keyConfig = new Uint8Array(await keys.arrayBuffer());
console.log(`key config: ${keyConfig.length} bytes, ${keys.headers.get("content-type")}`);
const oblivious = { relay: relayArg ?? `${gateway}/gateway`, keyConfig };

const get = await obliviousFetch(oblivious, "GET", "/v1/ping");
console.log("GET  /v1/ping →", get.status, await get.text());
const post = await obliviousFetch(oblivious, "POST", "/v1/ping", JSON.stringify({ hello: "zcash", n: 7 }));
console.log("POST /v1/ping →", post.status, await post.text());
const missing = await obliviousFetch(oblivious, "GET", "/v1/nothing");
console.log("GET  /v1/nothing →", missing.status, await missing.text());
