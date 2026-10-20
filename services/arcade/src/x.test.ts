import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { solvePow } from "@kakure/arcade";
import { publicKeyFor, signDocument } from "@kakure/signing";

// Sign in with X reads its settings at import; set them first.
process.env.X_CLIENT_ID = "client-test";
process.env.X_REDIRECT_URI = "https://kakure.example/x";
const { linkX, xConfig } = await import("./x");
const { register } = await import("./handlers");
const { ArcadeStore } = await import("./store");

const now = () => Math.floor(Date.now() / 1000);
const VERIFIER = "v".repeat(43);

/** X, stubbed: the token exchange, the account behind it, and the revocation, each call recorded. */
function stubX(account: { id: string; username: string }) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/oauth2/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code_verifier"), VERIFIER);
      assert.equal(body.get("client_id"), "client-test");
      return Response.json({ access_token: "token-1", token_type: "bearer" });
    }
    if (url.endsWith("/2/users/me")) return Response.json({ data: { ...account, name: "Someone" } });
    if (url.endsWith("/oauth2/revoke")) return Response.json({ revoked: true });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return calls;
}

describe("Sign in with X", () => {
  const key = (n: number) => {
    const secret = new Uint8Array(32).fill(n);
    return { secret, player: Buffer.from(publicKeyFor(secret)).toString("hex") };
  };
  // Each sign-in carries its own code (X issues one per consent), so no two requests are copies.
  let codes = 0;
  const link = (store: InstanceType<typeof ArcadeStore>, k: ReturnType<typeof key>) => {
    codes += 1;
    return linkX(
      store,
      signDocument(
        { action: "x-link", player: k.player, code: `code-${codes}`, verifier: VERIFIER, at: now() },
        k.secret,
      ),
    );
  };

  it("names the device with the handle, keeps no token, and revokes it", async () => {
    assert.deepEqual(xConfig(), { clientId: "client-test", redirectUri: "https://kakure.example/x" });
    const store = new ArcadeStore(":memory:");
    const calls = stubX({ id: "1234", username: "kakure_fan" });
    const me = key(31);
    assert.deepEqual(await link(store, me), { ok: true, body: { nickname: "kakure_fan" } });
    assert.ok(calls.some((u) => u.endsWith("/oauth2/revoke")));
    assert.equal(store.nicknameOf(me.player), "kakure_fan");
    assert.equal(store.x.handleOf(me.player), "kakure_fan");
    // Its name is its handle now: a proof-of-work rename is refused.
    const rename = {
      player: me.player,
      nickname: "Other",
      nonce: solvePow({ player: me.player, nickname: "Other" }),
      at: now(),
    };
    assert.equal(register(store, signDocument(rename, me.secret)).ok, false);
  });

  it("gives one X account one device, and never takes a nickname someone holds", async () => {
    const store = new ArcadeStore(":memory:");
    stubX({ id: "1234", username: "kakure_fan" });
    assert.equal((await link(store, key(31))).ok, true);
    const second = await link(store, key(32));
    assert.equal(second.ok, false);
    const holder = key(33);
    const nickname = "taken_name";
    register(
      store,
      signDocument(
        { player: holder.player, nickname, nonce: solvePow({ player: holder.player, nickname }), at: now() },
        holder.secret,
      ),
    );
    stubX({ id: "999", username: "Taken_Name" });
    assert.equal((await link(store, key(34))).ok, false);
  });
});
