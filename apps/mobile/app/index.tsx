// S00 smoke screen for the zingolib binding. Temporary: S06 replaces it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import {
  SMOKE_MEMO,
  SMOKE_NETWORK,
  SMOKE_SEND_ZATOSHIS,
  SPENDABLE_MAX_TRIES,
  SPENDABLE_RETRY_MS,
  SYNC_MAX_POLLS,
  SYNC_POLL_MS,
  TESTNET_SERVER,
  ZATOSHIS_PER_ZEC,
  ZEC_DECIMALS,
} from "@/constants";
import * as Zingo from "@/modules/zingo";

type LogLine = { at: string; text: string };

const describe = (error: unknown) => {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return code ? `${code}: ${error.message}` : error.message;
  }
  return String(error);
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const zec = (zatoshis: number | null | undefined) =>
  zatoshis === null || zatoshis === undefined ? "—" : `${(zatoshis / ZATOSHIS_PER_ZEC).toFixed(ZEC_DECIMALS)} TAZ`;

// The smoke log goes to Metro too, so a run can be read from the terminal.
const report = (text: string) => {
  // biome-ignore lint/suspicious/noConsole: S00 smoke evidence (addresses, txids, timings; never secrets)
  console.info(`[S00] ${text}`);
};

export default function SmokeScreen() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [toAddress, setToAddress] = useState("");
  const [zatoshis, setZatoshis] = useState(SMOKE_SEND_ZATOSHIS);
  const [memo, setMemo] = useState(SMOKE_MEMO);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const append = useCallback((text: string) => {
    report(text);
    setLog((lines) => [{ at: new Date().toLocaleTimeString("en-GB"), text }, ...lines]);
  }, []);

  const run = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusy(label);
      const started = Date.now();
      try {
        await task();
        append(`${label}: done in ${Date.now() - started} ms`);
      } catch (error) {
        append(`${label} failed after ${Date.now() - started} ms. ${describe(error)}`);
      } finally {
        setBusy(null);
      }
    },
    [append],
  );

  useEffect(() => {
    run("Open wallet", async () => {
      const opened = await Zingo.openWallet(SMOKE_NETWORK, TESTNET_SERVER);
      append(`wallet ${opened.status} (chain ${opened.chain}, birthday ${opened.birthday ?? "—"})`);
    });
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [append, run]);

  const create = () =>
    run("Create testnet wallet", async () => {
      const created = await Zingo.createWallet(SMOKE_NETWORK, TESTNET_SERVER);
      append(`wallet ${created.status} (birthday ${created.birthday}); seed is in the Keychain only`);
    });

  const showAddress = () =>
    run("Show address", async () => {
      const ua = await Zingo.getAddress();
      setAddress(ua.address);
      append(
        `address #${ua.addressIndex} orchard=${ua.orchard} sapling=${ua.sapling} transparent=${ua.transparent}: ${ua.address}`,
      );
    });

  const pollSync = useCallback(async () => {
    try {
      const status = await Zingo.syncStatus();
      const pct = status.progress.percentage_total_blocks_scanned;
      append(`sync ${status.phase} ${pct}% wallet ${status.walletHeight} / server ${status.serverHeight}`);
      if (status.phase !== "running" && polling.current) {
        clearInterval(polling.current);
        polling.current = null;
      }
    } catch (error) {
      append(`sync status failed. ${describe(error)}`);
    }
  }, [append]);

  const startSync = () =>
    run("Sync", async () => {
      const started = await Zingo.sync();
      append(started.status);
      if (polling.current) clearInterval(polling.current);
      polling.current = setInterval(pollSync, SYNC_POLL_MS);
    });

  const showBalance = () =>
    run("Balance", async () => {
      const { pools, spendable } = await Zingo.balance();
      append(
        `balance ironwood ${zec(pools.total_ironwood_balance)}, orchard ${zec(pools.total_orchard_balance)}, ` +
          `sapling ${zec(pools.total_sapling_balance)}, transparent ${zec(pools.total_transparent_balance)}; ` +
          `spendable ${JSON.stringify(spendable)}`,
      );
    });

  // Bounded: up to SPENDABLE_MAX_TRIES syncs, SPENDABLE_RETRY_MS apart, until the send amount is spendable.
  const syncUntilSpendable = () =>
    run("Sync until spendable", async () => {
      const needed = BigInt(zatoshis.trim() || "0");
      for (let attempt = 1; attempt <= SPENDABLE_MAX_TRIES; attempt += 1) {
        await Zingo.sync();
        let status = await Zingo.syncStatus();
        for (let poll = 0; status.phase === "running" && poll < SYNC_MAX_POLLS; poll += 1) {
          await sleep(SYNC_POLL_MS);
          status = await Zingo.syncStatus();
        }
        const { pools, spendable } = await Zingo.balance();
        const spendableZat = BigInt(spendable.spendable_balance ?? 0);
        append(
          `try ${attempt}: sync ${status.phase} wallet ${status.walletHeight} / server ${status.serverHeight}; ` +
            `ironwood ${zec(pools.total_ironwood_balance)} (confirmed ${zec(pools.confirmed_ironwood_balance)}), ` +
            `orchard ${zec(pools.total_orchard_balance)}; spendable ${spendableZat} zat`,
        );
        if (spendableZat >= needed) return;
        await sleep(SPENDABLE_RETRY_MS);
      }
      throw new Error(`fewer than ${needed} zat spendable after ${SPENDABLE_MAX_TRIES} tries`);
    });

  const sendTx = () =>
    run("Send", async () => {
      const sent = await Zingo.send(toAddress.trim(), BigInt(zatoshis.trim()), memo);
      const t = sent.timings;
      append(
        `sent txids ${sent.txids.join(", ")} fee ${sent.fee} zat from [${sent.sourcePools.join(", ")}] ` +
          `to [${sent.destinationPools.join(", ")}]; mixnet ${t.mixnetMs} ms ` +
          `(proxy ${t.proxyStartMs} ms), propose ${t.proposeMs} ms, confirm ${t.confirmMs} ms, total ${t.totalMs} ms`,
      );
    });

  const actions: [string, () => void][] = [
    ["Create testnet wallet", create],
    ["Sync", startSync],
    ["Balance", showBalance],
    ["Show address", showAddress],
    ["Sync until spendable", syncUntilSpendable],
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.note}>
        S00 binding smoke on {SMOKE_NETWORK} via {TESTNET_SERVER}. {busy ? `Running: ${busy}…` : "Idle."}
      </Text>
      <View style={styles.row}>
        {actions.map(([label, onPress]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={onPress}
            style={[styles.button, busy !== null && styles.disabled]}
          >
            <Text style={styles.buttonText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {address ? (
        <Text selectable style={styles.address}>
          {address}
        </Text>
      ) : null}
      <Text style={styles.heading}>Send</Text>
      <TextInput
        style={styles.input}
        placeholder="Recipient address"
        autoCapitalize="none"
        autoCorrect={false}
        value={toAddress}
        onChangeText={setToAddress}
      />
      <TextInput
        style={styles.input}
        placeholder="Zatoshis"
        keyboardType="number-pad"
        value={zatoshis}
        onChangeText={setZatoshis}
      />
      <TextInput style={styles.input} placeholder="Memo" autoCapitalize="none" value={memo} onChangeText={setMemo} />
      <Pressable
        accessibilityRole="button"
        disabled={busy !== null || toAddress.trim() === ""}
        onPress={sendTx}
        style={[styles.button, (busy !== null || toAddress.trim() === "") && styles.disabled]}
      >
        <Text style={styles.buttonText}>Send</Text>
      </Pressable>
      <Text style={styles.heading}>Log</Text>
      {log.map((line, index) => (
        <Text key={`${line.at}-${index}`} selectable style={styles.log}>
          {line.at} {line.text}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  note: { fontSize: 13, opacity: 0.7 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { backgroundColor: "#1f6feb", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  disabled: { opacity: 0.4 },
  buttonText: { color: "#fff", fontWeight: "600" },
  address: { fontFamily: "Menlo", fontSize: 12 },
  heading: { fontSize: 16, fontWeight: "700", marginTop: 8 },
  input: { borderWidth: 1, borderColor: "#8884", borderRadius: 8, padding: 10, fontFamily: "Menlo", fontSize: 12 },
  log: { fontFamily: "Menlo", fontSize: 11 },
});
