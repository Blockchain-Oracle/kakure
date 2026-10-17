import { Redirect } from "expo-router";
import { useOnboarded } from "@/onboarding/onboarded";

/** First run walks the promise, a wallet and its backup; afterwards the app opens on Markets. */
export default function Index() {
  const onboarded = useOnboarded();
  return <Redirect href={onboarded ? "/markets" : "/welcome"} />;
}
