"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";

export default function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();

  function change(nextLocale: string) {
    if (nextLocale === locale || !["en", "hu"].includes(nextLocale)) return;
    document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; samesite=lax; secure`;
    router.refresh();
  }

  return (
    <label className="locale-picker">
      <span className="sr-only">Language / Nyelv</span>
      <select value={locale} onChange={(event) => change(event.target.value)}>
        <option value="en">EN</option>
        <option value="hu">HU</option>
      </select>
    </label>
  );
}
