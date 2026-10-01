"use client";

import { Sprout } from "lucide-react";
import { useUi } from "@/components/providers/ui-provider";
import { Button } from "@/components/ui/button";

export function CreateBranchButton() {
  const { openCreateBranch } = useUi();
  return (
    <Button onClick={openCreateBranch}>
      <Sprout /> Create root branch
    </Button>
  );
}
