"use client";
import { useEffect, useRef } from "react";
import { adminMembershipRecovery } from "@/lib/adminClient";
import { registerAdminReadRecovery } from "@/lib/adminReadRecovery";

/** Opt in only a pure loader with NO prior successful page/editor adoption. */
export function useAdminReadRecovery(load: () => Promise<void>, eligible: boolean) {
  const current = useRef({ load, eligible }); current.current = { load, eligible };
  useEffect(() => registerAdminReadRecovery(adminMembershipRecovery,
    () => current.current.eligible, () => current.current.load()), []);
}
