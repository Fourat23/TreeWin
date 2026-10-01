"use client";

import { Plus, Sprout } from "lucide-react";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";

export function DashboardActions() {
  const { openNewTicket, openCreateBranch } = useUi();
  return (
    <div className="hidden gap-2 lg:flex">
      <Button onClick={openCreateBranch}>
        <Sprout /> Create branch
      </Button>
      <Button variant="primary" onClick={() => openNewTicket()}>
        <Plus /> New round
      </Button>
    </div>
  );
}
