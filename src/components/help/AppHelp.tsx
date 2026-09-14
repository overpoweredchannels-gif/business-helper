"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { HelpCenter } from "./HelpCenter";
const publicPaths = new Set(["/login", "/signup", "/reset", "/auth/callback", "/invite"]);
export default function AppHelp() {
  const pathname = usePathname(); const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => { if (!cancelled) setUserId(data.session?.user.id ?? null); }).catch(() => {});
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, []);
  if (!userId || publicPaths.has(pathname)) return null;
  return <HelpCenter key={userId} userId={userId} />;
}
