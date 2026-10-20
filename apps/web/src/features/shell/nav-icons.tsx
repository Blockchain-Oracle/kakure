import {
  Activity,
  BadgeCheck,
  BookOpen,
  CandlestickChart,
  ChartLine,
  Download,
  FileCheck2,
  Gamepad2,
  History,
  type LucideIcon,
  Medal,
  Settings,
  Shield,
  Trophy,
  WalletCards,
} from "lucide-react";
import type { NavId } from "./places";

/** One lucide icon per registry entry (the registry itself stays plain data for the reachability script). */
export const NAV_ICONS: Record<NavId, LucideIcon> = {
  trade: CandlestickChart,
  markets: ChartLine,
  portfolio: WalletCards,
  games: Gamepad2,
  leaderboard: Trophy,
  "games-rank": Medal,
  "games-history": History,
  verify: BadgeCheck,
  proof: FileCheck2,
  privacy: Shield,
  docs: BookOpen,
  download: Download,
  settings: Settings,
  status: Activity,
};
