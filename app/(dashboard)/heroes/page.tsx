import { redirect } from "next/navigation";

/**
 * The People hero console was replaced by `/appearance` in the D-052 cutover
 * (T-468). The route survives only so older bookmarks and links still land
 * somewhere useful; its editor, allow-listed actions and navigation entry are
 * gone. Deleting the route itself is a separate product decision.
 */
export default function HeroesPage() {
  redirect("/appearance");
}
