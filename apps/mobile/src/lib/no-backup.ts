import * as Zingo from "@zingo";
import { Platform } from "react-native";
import { devLog } from "@/lib/dev-log";

/**
 * Nothing Kakure keeps on this phone goes into a cloud or computer backup (plan §2 Device storage; audit O4):
 * the wallet, the encrypted ticket database, the key-value store, cached public files and preferences.
 * iOS: Documents and Library are flagged as excluded, directory and files, on every launch (new files inherit the
 * directory's flag). Android: `allowBackup="false"` plus data extraction rules that exclude every domain from cloud
 * backup and device transfer (plugins/with-no-backup.js).
 */
export function keepAppDataOutOfBackups(): void {
  if (Platform.OS !== "ios") return;
  Zingo.excludeAppDataFromBackup()
    .then((result) => devLog(`backup exclusion: ${result.excluded} items flagged, ${result.refused} refused`))
    .catch(() => undefined);
}
