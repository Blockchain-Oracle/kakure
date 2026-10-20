import { Check, X } from "lucide-react";
import Link from "next/link";
import { WORDS } from "./words";

/**
 * Who sees what, as a matrix (plan §00 "Who sees what": You / The relay / The operator / Everyone else). Rows are the
 * facts of one trade; each cell says whether that party can see it.
 */
export function PrivacyMatrix() {
  const { privacy } = WORDS;
  return (
    <section className="lp-section" aria-labelledby="lp-privacy-title">
      <div className="lp-wrap">
        <p className="lp-kicker">{privacy.kicker}</p>
        <h2 id="lp-privacy-title" className="lp-h2 lp-silver">
          <span>{privacy.title[0]}</span>
          <span>
            <em>{privacy.title[1]}</em>
          </span>
        </h2>
        <table className="lp-matrix">
          <thead>
            <tr>
              <td />
              {privacy.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {privacy.rows.map((row) => (
              <tr key={row.what}>
                <th scope="row">{row.what}</th>
                {row.sees.map((sees, i) => (
                  <td key={privacy.columns[i]}>
                    {sees ? (
                      <span className="lp-yes" role="img" aria-label={privacy.sees}>
                        <Check aria-hidden />
                      </span>
                    ) : (
                      <span className="lp-no" role="img" aria-label={privacy.never}>
                        <X aria-hidden />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-5 max-w-3xl text-row-detail text-muted-foreground">
          {privacy.note}{" "}
          <Link href="/privacy" className="lp-link font-semibold text-foreground underline underline-offset-4">
            {privacy.more}
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
