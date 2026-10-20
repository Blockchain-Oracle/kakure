import type { Metadata } from "next";
import { ProfileScreen } from "@/features/games/profile/profile-screen";

/** `/u#<nickname>`: a nickname's public play and badges (plan §0 R7); the name stays in the fragment. */
export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProfileScreen />;
}
