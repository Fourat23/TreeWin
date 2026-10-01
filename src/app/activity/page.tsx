import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader } from "@/components/ui/misc";
import { getActivityFeed } from "@/server/queries/overview";
import { loadPageState } from "@/server/state/page";

export const metadata: Metadata = { title: "Activity" };

const cursorSchema = z.coerce.number().int().positive().optional().catch(undefined);

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  const cursor = cursorSchema.parse(before);
  const { state } = await loadPageState();
  const { items, nextCursor } = getActivityFeed(state, { limit: 60, before: cursor });
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Recent activity"
        description="Wins, losses, harvests, BANK transfers, births and deaths — newest first."
      />
      <Card className="px-5 py-2">
        <ActivityFeed items={items} />
      </Card>
      <div className="mt-4 flex justify-between">
        {cursor ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/activity">Newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {nextCursor ? (
          <Button size="sm" asChild>
            <Link href={`/activity?before=${nextCursor}`}>
              Older <ChevronRight />
            </Link>
          </Button>
        ) : null}
      </div>
    </PageContainer>
  );
}
