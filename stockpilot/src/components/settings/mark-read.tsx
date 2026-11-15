"use client";
import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { markRead } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return <Button variant="outline" loading={pending} onClick={() => start(() => markRead("all"))}><CheckCheck /> Mark all read</Button>;
}
