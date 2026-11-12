import "server-only";
import { getMessages } from "next-intl/server";
import { clientMessagePaths, pickClientMessages, type ClientMessageScopeName } from "@/lib/clientMessageScopes";

/**
 * The messages a layout's `NextIntlClientProvider` ships for `scope`, in the request's
 * locale. Server components keep the full catalogue (`getTranslations`).
 */
export async function clientMessages(scope: ClientMessageScopeName) {
  return pickClientMessages(await getMessages(), clientMessagePaths(scope));
}
