"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DatesIntakeSourcePanel from "@/components/DatesIntakeSourcePanel";
import { adminCall } from "@/lib/adminClient";
import { readDatesIntakeDraftEntry, type DatesIntakeDraftEntry } from "@/lib/datesIntakeConsole";

/**
 * "Draft from source" on the external events page. It asks Core whether the
 * admin-draft switch is on and whether this operator may create a draft, and
 * shows the entry accordingly: available, disabled with the reason, or not at
 * all for an operator who could never use it.
 */
export default function DatesIntakeSourceEntry() {
  const [entry, setEntry] = useState<DatesIntakeDraftEntry | null>(null);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void readDatesIntakeDraftEntry(adminCall, controller.signal).then((value) => { if (live) setEntry(value); });
    return () => { live = false; controller.abort(); };
  }, []);
  return entry ? <DatesIntakeSourcePanel entry={entry} onCreated={(intakeId) => router.push(`/dates/intakes/${intakeId}`)} /> : null;
}
