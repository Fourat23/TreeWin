"use client";

import { Plus } from "lucide-react";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";

export function NewRoundButton({ branchId }: { branchId?: string }) {
  const { openNewTicket } = useUi();
  return (
    <Button variant="primary" onClick={() => openNewTicket(branchId ? { branchId } : undefined)}>
      <Plus /> New round
    </Button>
  );
}
