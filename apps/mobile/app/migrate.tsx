import { zatToZec } from "@kakure/domain";
import * as Zingo from "@zingo";
import { router } from "expo-router";
import { Repeat } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking } from "react-native";
import { NETWORK_COIN, ZODL_URL } from "@/constants";
import { fire } from "@/feedback/fire";
import { Button } from "@/kit/button";
import { SheetBody } from "@/kit/screen";
import { SlideToConfirm } from "@/kit/slide-to-confirm";
import { EmptyState, Skeleton, Strip } from "@/kit/states";
import { Fact, Plate } from "@/kit/surface";
import { useNetwork } from "@/network/network-store";
import { errorOf, refreshWallet } from "@/wallet/wallet-store";

/**
 * Orchard → Ironwood (C10, G4). The binding exposes the immediate migration (`plan_orchard_drain` +
 * `drain_orchard_to_ironwood`); the amount crossing the pool boundary is visible on chain, so the sheet says so
 * before the slide. If this build can't migrate, it points to Zodl, which can.
 */
export default function Migrate() {
  const network = useNetwork();
  const coin = NETWORK_COIN[network];
  const [plan, setPlan] = useState<Zingo.DrainPlan | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<"plan" | "moving" | "done">("plan");

  useEffect(() => {
    Zingo.planOrchardDrain()
      .then(setPlan)
      .catch((error) => setProblem(errorOf(error).message));
  }, []);

  const zec = (zat: number) => `${zatToZec(BigInt(Math.max(0, zat)))} ${coin}`;

  if (problem) {
    return (
      <EmptyState
        icon={Repeat}
        title="This wallet can't plan the move"
        reason={`${problem}. Zodl can migrate Orchard funds: restore your words there, move them, then send them back here.`}
        action={{ label: "Open zodl.com", onPress: () => void Linking.openURL(ZODL_URL) }}
        secondary={{ label: "Close", onPress: () => router.back() }}
      />
    );
  }
  if (!plan)
    return (
      <SheetBody title="Move to Ironwood">
        <Skeleton style={{ height: 120 }} />
      </SheetBody>
    );
  if (state === "done") {
    return (
      <EmptyState
        icon={Repeat}
        title="Moving to Ironwood"
        reason="The migration is on its way. Your Ironwood balance updates once it confirms."
        action={{ label: "Done", onPress: () => router.back() }}
      />
    );
  }
  if (plan.transactions.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="Nothing to move"
        reason={`There's no Orchard balance worth migrating${plan.residual > 0 ? ` (${zec(plan.residual)} is too small to move)` : ""}.`}
        action={{ label: "Close", onPress: () => router.back() }}
      />
    );
  }

  return (
    <SheetBody title="Move to Ironwood" subtitle="Bets spend Ironwood only, so they never cross pools.">
      <Plate raised>
        <Fact label="Moves" value={zec(plan.migrated)} />
        <Fact label="Network fee" value={zec(plan.fee)} />
        <Fact label="Transactions" value={String(plan.transactions.length)} />
        {plan.residual > 0 ? <Fact label="Left in Orchard (dust)" value={zec(plan.residual)} /> : null}
      </Plate>
      <Strip>
        Moving now shows the amount crossing from Orchard to Ironwood on chain. It isn't linked to your bets, but it is
        visible.
      </Strip>
      {state === "moving" ? (
        <Button label="Moving…" busy onPress={() => undefined} />
      ) : (
        <SlideToConfirm
          label="Slide to move now"
          onConfirm={() => {
            setState("moving");
            Zingo.drainOrchard()
              .then(() => {
                fire("confirmed");
                setState("done");
                void refreshWallet();
              })
              .catch((error) => {
                setProblem(errorOf(error).message);
                fire("error");
              });
          }}
        />
      )}
    </SheetBody>
  );
}
