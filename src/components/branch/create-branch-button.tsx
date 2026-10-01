"use client";

import { Sprout } from "lucide-react";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";

export function CreateBranchButton() {
  const { openCreateBranch, hints } = useUi();
  // REAL: hidden once the single external seed has been used (strategy splits only).
  if (!hints.canCreateRoot) return null;
  return (
    <Button onClick={openCreateBranch}>
      <Sprout /> Create root branch
    </Button>
  );
}
