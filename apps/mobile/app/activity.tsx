import { zatToZec } from "@kakure/domain";
import type { ValueTransfer } from "@zingo";
import { ArrowDownLeft, ArrowUpRight, History, Repeat } from "lucide-react-native";
import { FlatList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MS_PER_SECOND, NETWORK_COIN } from "@/constants";
import { Pill } from "@/kit/controls";
import { EmptyState } from "@/kit/states";
import { Row } from "@/kit/surface";
import { formatDateTime } from "@/lib/time";
import { useNetwork } from "@/network/network-store";
import { usePrefs } from "@/settings/prefs";
import { useTheme } from "@/theme/theme-provider";
import { useWallet } from "@/wallet/wallet-store";

/** Activity (C10): the wallet's own history, newest first, each row saying what happened to the money. */
const STATUS: Record<ValueTransfer["status"], { label: string; tone: "neutral" | "up" | "warn" | "quiet" | "down" }> = {
  calculated: { label: "Built", tone: "quiet" },
  transmitted: { label: "Sent", tone: "neutral" },
  mempool: { label: "In mempool", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "up" },
  failed: { label: "Failed · nothing moved", tone: "down" },
};

function title(transfer: ValueTransfer, coin: string, hidden: boolean): string {
  const amount = hidden ? "Hidden" : `${zatToZec(BigInt(Math.max(0, transfer.value)))} ${coin}`;
  if (transfer.kind === "received") return `Received ${amount}`;
  if (transfer.kind === "migration") return `Moved ${amount} to Ironwood`;
  if (transfer.memos?.some((memo) => memo.startsWith("kakure:v1"))) return `Bet ${amount}`;
  return `Sent ${amount}`;
}

export default function Activity() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const wallet = useWallet();
  const network = useNetwork();
  const { hideAmounts } = usePrefs();
  const rows = [...wallet.activity].sort((left, right) => right.datetime - left.datetime);
  return (
    <FlatList
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={{
        padding: theme.space.inset,
        gap: theme.space.sm,
        paddingBottom: insets.bottom + theme.space.xl,
      }}
      data={rows}
      keyExtractor={(item, index) => `${item.txid}-${index}`}
      ListEmptyComponent={
        <EmptyState
          icon={History}
          title="Nothing here yet"
          reason="Money you receive, send or bet with this wallet shows here once the wallet sees it."
        />
      }
      renderItem={({ item }) => {
        const status = STATUS[item.status] ?? STATUS.transmitted;
        const Icon = item.kind === "received" ? ArrowDownLeft : item.kind === "migration" ? Repeat : ArrowUpRight;
        return (
          <Row
            icon={Icon}
            title={title(item, NETWORK_COIN[network], hideAmounts)}
            detail={`${formatDateTime(item.datetime * MS_PER_SECOND)} · ${(item.pools_received.length > 0 ? item.pools_received : item.pools_sent_from).join(", ") || "shielded"}`}
            trailing={
              <View>
                <Pill label={status.label} tone={status.tone} />
              </View>
            }
          />
        );
      }}
    />
  );
}
