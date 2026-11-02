"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { datesSystemClosureBlockerWorded, type DatesSystemClosure } from "@/lib/datesSystemClosure";

/**
 * D-149 W5: the system's closure of a research intake - not publishable (with the gate's blocker in words, or the
 * publication writer's code as Core wrote it) or a duplicate. Nobody has to act on it.
 */
export default function DatesSystemClosureNote({ closure }: { closure: DatesSystemClosure }) {
  const t = useTranslations("datesAdmin.research.closure");
  return <small className="dates-system-closure">{t(closure.decision === "duplicate" ? "duplicate" : "notPublishable")}
    {closure.decision !== "duplicate" && <> · {datesSystemClosureBlockerWorded(closure.blocker) ? t(`blockers.${closure.blocker}`) : <code>{closure.blocker}</code>}</>}</small>;
}
