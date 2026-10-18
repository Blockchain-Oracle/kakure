/**
 * Keeps every app file out of Android backups and device-to-device transfers (plan §2 Device storage; audit O4).
 *
 * `allowBackup="false"` stops cloud backup, but on Android 12+ some manufacturers still run device-to-device
 * transfers for such apps (developer.android.com/identity/data/autobackup). The data extraction rules (Android 12+)
 * and the full backup rules (Android 11 and lower) therefore exclude every storage domain from both. Cache and
 * no-backup directories are never copied anyway. These rules replace expo-secure-store's, which copy shared
 * preferences other than SecureStore's (app.json turns its `configureAndroidBackup` off).
 */
const fs = require("node:fs");
const path = require("node:path");
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];
const EXTRACTION_RULES = "kakure_data_extraction_rules";
const BACKUP_RULES = "kakure_backup_rules";

const excludeAll = (indent) => DOMAINS.map((domain) => `${indent}<exclude domain="${domain}" path="."/>`).join("\n");

const extractionXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 and higher: nothing goes to cloud backup or to a new device (plugins/with-no-backup.js). -->
<data-extraction-rules>
  <cloud-backup>
${excludeAll("    ")}
  </cloud-backup>
  <device-transfer>
${excludeAll("    ")}
  </device-transfer>
</data-extraction-rules>
`;

const backupXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 and lower: nothing is backed up (plugins/with-no-backup.js). -->
<full-backup-content>
${excludeAll("  ")}
</full-backup-content>
`;

function withNoBackupManifest(config) {
  return withAndroidManifest(config, (next) => {
    const manifest = next.modResults.manifest;
    manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(next.modResults);
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = `@xml/${BACKUP_RULES}`;
    application.$["android:dataExtractionRules"] = `@xml/${EXTRACTION_RULES}`;
    // A library manifest that sets any of these must not win the merge.
    const replace = new Set((application.$["tools:replace"] ?? "").split(",").filter(Boolean));
    for (const attribute of ["android:allowBackup", "android:fullBackupContent", "android:dataExtractionRules"]) {
      replace.add(attribute);
    }
    application.$["tools:replace"] = [...replace].join(",");
    return next;
  });
}

function withNoBackupRules(config) {
  return withDangerousMod(config, [
    "android",
    (next) => {
      const directory = path.join(next.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, `${EXTRACTION_RULES}.xml`), extractionXml);
      fs.writeFileSync(path.join(directory, `${BACKUP_RULES}.xml`), backupXml);
      return next;
    },
  ]);
}

module.exports = (config) => withNoBackupRules(withNoBackupManifest(config));
