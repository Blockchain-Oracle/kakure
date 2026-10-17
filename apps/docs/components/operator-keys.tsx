import { OPERATOR_PUBLIC_KEYS } from "@kakure/query";

/** The operator keys pinned in the app build (packages/query/src/constants.ts), read when the docs are built. */
export function OperatorKeys() {
  return (
    <table>
      <thead>
        <tr>
          <th>Network</th>
          <th>Ed25519 public key (hex)</th>
        </tr>
      </thead>
      <tbody>
        {(Object.keys(OPERATOR_PUBLIC_KEYS) as Array<keyof typeof OPERATOR_PUBLIC_KEYS>).map((network) => (
          <tr key={network}>
            <td>{network === "mainnet" ? "Mainnet" : "Testnet"}</td>
            <td>
              <code className="break-all">{OPERATOR_PUBLIC_KEYS[network] ?? "not published yet"}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
