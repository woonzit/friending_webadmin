/**
 * Section-level operator help for the Pinger page, where members' Hey is configured.
 * The topic keys index `pinger.sectionHelp.topics` in both locale files; the Pinger
 * wire names themselves stay stable for released clients.
 */
export const PINGER_HELP_SECTIONS = {
  runtime: ["enabled", "cooldown", "retention", "chatDefault", "chatContract", "actionKey"],
  icons: ["states", "upload"],
  copy: ["messages", "placeholders"],
  audit: ["history"],
} as const;

export type PingerHelpSection = keyof typeof PINGER_HELP_SECTIONS;

export type PingerAvailability = "off" | "globalOff" | "unknown" | "on";

/**
 * Whether the SAVED configuration lets members send a Hey. Core refuses a send
 * when either this page's switch or the product-wide Hey feature switch is off,
 * so both are needed. An unreadable feature switch is "unknown", never "on" or
 * "off". This is configuration eligibility only; it says nothing about a
 * member's remaining daily allowance or a pair's cooldown.
 */
export function pingerAvailability(enabled: boolean, globalEnabled: boolean | null): PingerAvailability {
  if (!enabled) return "off";
  if (globalEnabled === false) return "globalOff";
  if (globalEnabled === null) return "unknown";
  return "on";
}

/** Reads a seconds value the way an operator thinks about it; the wire unit stays seconds. */
export function pingerDuration(seconds: number, locale: string): string | null {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  let remaining = seconds;
  const parts: string[] = [];
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]] as const) {
    const value = Math.floor(remaining / size);
    remaining %= size;
    if (value > 0 || (unit === "second" && parts.length === 0)) {
      parts.push(new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value));
    }
  }
  return parts.join(" ");
}
