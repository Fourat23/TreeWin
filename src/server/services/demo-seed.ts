import { eq } from "drizzle-orm";
import { suggestedStakeCents } from "@/domain/strategy/engine";
import type { Profile, SettleResult } from "@/domain/types";
import type { Db } from "../db/client";
import { branches } from "../db/schema";
import { isDatabaseEmpty } from "./backup-service";
import { createTicket, settleTicket } from "./bet-service";
import { createRootBranch } from "./branch-service";
import { createCandidate } from "./candidate-service";
import { DomainError } from "./errors";
import { localDay } from "./internal";

/**
 * Demo dataset. Nothing is inserted "by hand": every ticket is created and settled through
 * the real services, so BANK transfers, splits, maturity and deaths follow the rules engine.
 * Resulting tree (codes depend on the rules, profiles of children are chosen explicitly):
 *
 *   A (balanced)  ── A1 (harvest, dead) · A2 (growth) ── A2.1 (harvest)
 *   B (harvest, mature) ── B1 (balanced, dead) · B2 (harvest) · B3 (growth)
 *   C (growth, dead)
 */

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface Match {
  sport: string;
  competition: string;
  eventName: string;
  selection: string;
  marketName?: string;
}

const MATCHES: Match[] = [
  { sport: "Football", competition: "Ligue 1", eventName: "PSG - Nantes", selection: "PSG" },
  {
    sport: "Football",
    competition: "Bundesliga",
    eventName: "Bayern - Mainz",
    selection: "Bayern",
  },
  {
    sport: "Football",
    competition: "LaLiga",
    eventName: "Real Madrid - Getafe",
    selection: "Real Madrid",
  },
  {
    sport: "Football",
    competition: "Premier League",
    eventName: "Arsenal - Burnley",
    selection: "Arsenal",
  },
  {
    sport: "Tennis",
    competition: "ATP Masters",
    eventName: "Sinner - Fritz",
    selection: "Sinner",
    marketName: "Vainqueur",
  },
  { sport: "Football", competition: "Serie A", eventName: "Inter - Lecce", selection: "Inter" },
  {
    sport: "Basketball",
    competition: "EuroLeague",
    eventName: "Real Madrid - ALBA Berlin",
    selection: "Real Madrid",
    marketName: "Vainqueur (prolongations incluses)",
  },
  {
    sport: "Football",
    competition: "Ligue 1",
    eventName: "Monaco - Le Havre",
    selection: "Monaco",
  },
  { sport: "Football", competition: "Eredivisie", eventName: "PSV - Heracles", selection: "PSV" },
  {
    sport: "Football",
    competition: "LaLiga",
    eventName: "Barcelona - Alavés",
    selection: "Barcelona",
  },
  {
    sport: "Tennis",
    competition: "WTA 1000",
    eventName: "Sabalenka - Kalinskaya",
    selection: "Sabalenka",
    marketName: "Vainqueur",
  },
  {
    sport: "Football",
    competition: "Premier League",
    eventName: "Liverpool - Ipswich",
    selection: "Liverpool",
  },
  {
    sport: "Football",
    competition: "Bundesliga",
    eventName: "Leverkusen - Bochum",
    selection: "Leverkusen",
  },
  { sport: "Football", competition: "Ligue 1", eventName: "Lille - Angers", selection: "Lille" },
  { sport: "Football", competition: "Serie A", eventName: "Napoli - Monza", selection: "Napoli" },
  {
    sport: "Basketball",
    competition: "NBA",
    eventName: "Celtics - Wizards",
    selection: "Celtics",
    marketName: "Vainqueur (prolongations incluses)",
  },
  {
    sport: "Football",
    competition: "Primeira Liga",
    eventName: "Benfica - Farense",
    selection: "Benfica",
  },
  {
    sport: "Football",
    competition: "Premier League",
    eventName: "Man City - Southampton",
    selection: "Man City",
  },
  {
    sport: "Football",
    competition: "LaLiga",
    eventName: "Atlético - Valladolid",
    selection: "Atlético",
  },
  {
    sport: "Tennis",
    competition: "ATP 500",
    eventName: "Alcaraz - Musetti",
    selection: "Alcaraz",
    marketName: "Vainqueur",
  },
  {
    sport: "Football",
    competition: "Ligue 1",
    eventName: "Marseille - Montpellier",
    selection: "Marseille",
  },
  {
    sport: "Football",
    competition: "Bundesliga",
    eventName: "Dortmund - Kiel",
    selection: "Dortmund",
  },
  {
    sport: "Football",
    competition: "Serie A",
    eventName: "Juventus - Venezia",
    selection: "Juventus",
  },
  {
    sport: "Football",
    competition: "Eredivisie",
    eventName: "Ajax - Almere City",
    selection: "Ajax",
  },
  {
    sport: "Football",
    competition: "Premier League",
    eventName: "Chelsea - Leicester",
    selection: "Chelsea",
  },
  {
    sport: "Football",
    competition: "Ligue 1",
    eventName: "Lyon - Saint-Étienne",
    selection: "Lyon",
  },
  {
    sport: "Basketball",
    competition: "NBA",
    eventName: "Nuggets - Hornets",
    selection: "Nuggets",
    marketName: "Vainqueur (prolongations incluses)",
  },
  {
    sport: "Football",
    competition: "LaLiga",
    eventName: "Villarreal - Leganés",
    selection: "Villarreal",
  },
  {
    sport: "Football",
    competition: "Bundesliga",
    eventName: "Leipzig - Heidenheim",
    selection: "Leipzig",
  },
  {
    sport: "Football",
    competition: "Serie A",
    eventName: "Atalanta - Empoli",
    selection: "Atalanta",
  },
  {
    sport: "Tennis",
    competition: "ATP Masters",
    eventName: "Djokovic - Shelton",
    selection: "Djokovic",
    marketName: "Vainqueur",
  },
  {
    sport: "Football",
    competition: "Premier League",
    eventName: "Tottenham - Wolves",
    selection: "Tottenham",
  },
  { sport: "Football", competition: "Ligue 1", eventName: "Lens - Auxerre", selection: "Lens" },
  {
    sport: "Football",
    competition: "LaLiga",
    eventName: "Athletic - Las Palmas",
    selection: "Athletic",
  },
  {
    sport: "Football",
    competition: "Primeira Liga",
    eventName: "Porto - Estrela",
    selection: "Porto",
  },
  { sport: "Football", competition: "Serie A", eventName: "Milan - Cagliari", selection: "Milan" },
];

export interface SeedSummary {
  branches: number;
  tickets: number;
  candidates: number;
}

export function seedDemoData(db: Db, now = new Date()): SeedSummary {
  if (!isDatabaseEmpty(db)) {
    throw new DomainError("INVALID_STATE", "Demo data can only be loaded into an empty database");
  }
  const origin = new Date(now);
  origin.setHours(0, 0, 0, 0);
  const start = origin.getTime() - 30 * DAY;
  const at = (day: number, hour: number) => new Date(start + day * DAY + hour * HOUR);

  let matchIndex = 0;
  let tickets = 0;
  const idOf = (code: string): string => {
    const row = db.select({ id: branches.id }).from(branches).where(eq(branches.code, code)).get();
    if (!row) throw new Error(`Seed: branch ${code} missing`);
    return row.id;
  };

  function round(
    code: string,
    day: number,
    hour: number,
    oddsBp: number,
    result: SettleResult | "PENDING",
    options: { childProfiles?: Profile[]; closingOddsBp?: number } = {},
  ): void {
    const id = idOf(code);
    const branch = db.select().from(branches).where(eq(branches.id, id)).get();
    if (!branch) throw new Error(`Seed: branch ${code} missing`);
    const match = MATCHES[matchIndex % MATCHES.length] as Match;
    matchIndex += 1;
    const pending = result === "PENDING";
    const { bet } = createTicket(
      db,
      {
        branchId: id,
        sport: match.sport,
        competition: match.competition,
        eventName: match.eventName,
        marketName: match.marketName ?? "Vainqueur du match",
        selection: match.selection,
        eventDate: localDay(pending ? new Date(now.getTime() + DAY) : at(day, 0)),
        eventTime: "21:00",
        oddsBp,
        stakeCents: suggestedStakeCents(branch),
        closingOddsBp: options.closingOddsBp,
        protocolStatus: "ELIGIBLE",
        confidence: 4,
        checklist: {
          singleMatch: "TRUE",
          preMatch: "TRUE",
          oddsInRange: "TRUE",
          teamStrengthGap: "TRUE",
          lineupKnown: result === "LOST" ? "UNKNOWN" : "TRUE",
          noCorrelation: "TRUE",
        },
      },
      pending ? new Date(now.getTime() - (4 - hour) * HOUR) : at(day, hour),
    );
    tickets += 1;
    if (!pending) {
      settleTicket(
        db,
        { betId: bet.id, result, childProfiles: options.childProfiles },
        at(day, hour + 4),
      );
    }
  }

  // Chronological script (day, hour). Child profiles are chosen explicitly for a varied tree.
  createRootBranch(db, { profile: "BALANCED", capitalCents: 10_000, notes: "Demo root" }, at(0, 9));
  round("A", 0, 12, 13_000, "WON", { closingOddsBp: 12_600 });
  round("A", 1, 12, 13_000, "WON", { closingOddsBp: 12_800 });
  round("A", 2, 12, 13_000, "WON");
  createRootBranch(
    db,
    { profile: "HARVEST", capitalCents: 200_000, notes: "Demo root" },
    at(2, 18),
  );
  round("A", 3, 12, 13_000, "WON", { childProfiles: ["HARVEST"], closingOddsBp: 13_200 }); // P1 → A1
  round("B", 3, 15, 13_000, "WON", { childProfiles: ["BALANCED"] }); // cap → MATURE, B1
  round("A1", 4, 12, 12_200, "WON");
  round("A1", 5, 12, 12_500, "LOST", { closingOddsBp: 12_700 });
  round("A", 5, 15, 12_800, "WON");
  round("A", 6, 12, 13_000, "WON");
  round("B1", 6, 15, 12_400, "LOST");
  round("B", 7, 12, 12_500, "WON", { childProfiles: ["HARVEST"], closingOddsBp: 12_300 }); // B2
  round("A", 8, 12, 12_500, "WON");
  round("A", 9, 12, 13_000, "WON");
  createRootBranch(db, { profile: "GROWTH", capitalCents: 15_000 }, at(9, 18));
  round("B", 10, 12, 12_300, "VOID");
  round("C", 10, 15, 12_500, "WON");
  round("A", 11, 12, 12_800, "WON");
  round("A", 12, 12, 13_000, "WON");
  round("C", 12, 15, 12_800, "LOST", { closingOddsBp: 13_100 });
  round("B", 13, 12, 12_200, "WON", { childProfiles: ["GROWTH"] }); // B3
  round("A", 14, 12, 12_600, "WON");
  round("A", 15, 12, 12_700, "WON", { childProfiles: ["GROWTH"] }); // 6×S threshold → A2
  round("B2", 15, 15, 12_500, "WON");
  round("A2", 16, 12, 13_000, "WON");
  round("A2", 17, 12, 12_400, "WON", { closingOddsBp: 12_100 });
  round("A2", 18, 12, 13_000, "WON");
  round("B2", 18, 15, 13_000, "WON", { closingOddsBp: 12_800 });
  round("A2", 19, 12, 12_700, "WON");
  round("A2", 20, 12, 12_500, "WON", { childProfiles: ["HARVEST"] }); // P1 → A2.1
  round("A2.1", 22, 12, 12_200, "WON", { closingOddsBp: 11_900 });
  round("A2", 23, 12, 12_900, "WON");

  // Open rounds waiting for their result.
  round("A", 0, 1, 12_600, "PENDING");
  round("A2.1", 0, 2, 12_400, "PENDING");
  round("B2", 0, 3, 12_300, "PENDING");

  // Shadow portfolio.
  const candidates = [
    {
      eventName: "Brest - Reims",
      selection: "Brest",
      odds: 12_400,
      closing: 12_200,
      status: "ELIGIBLE",
      result: "WON",
    },
    {
      eventName: "Sevilla - Mallorca",
      selection: "Sevilla",
      odds: 12_900,
      closing: 13_200,
      status: "WATCH",
      result: "LOST",
    },
    {
      eventName: "Feyenoord - Sparta",
      selection: "Feyenoord",
      odds: 12_200,
      closing: 12_000,
      status: "ELIGIBLE",
      result: "WON",
    },
    {
      eventName: "Roma - Como",
      selection: "Roma",
      odds: 13_400,
      closing: null,
      status: "REJECTED",
      result: "WON",
    },
    {
      eventName: "Newcastle - Brentford",
      selection: "Newcastle",
      odds: 12_600,
      closing: null,
      status: "WATCH",
      result: "PENDING",
    },
    {
      eventName: "Stuttgart - Augsburg",
      selection: "Stuttgart",
      odds: 12_800,
      closing: 12_500,
      status: "ELIGIBLE",
      result: "WON",
    },
  ] as const;
  candidates.forEach((c, i) => {
    createCandidate(
      db,
      {
        eventDate: localDay(at(18 + i * 2, 0)),
        sport: "Football",
        competition: "Demo",
        eventName: c.eventName,
        marketName: "Vainqueur du match",
        selection: c.selection,
        oddsObservedBp: c.odds,
        closingOddsBp: c.closing,
        protocolStatus: c.status,
        result: c.result,
        checklist: {
          singleMatch: "TRUE",
          preMatch: "TRUE",
          oddsInRange: c.status === "REJECTED" ? "FALSE" : "TRUE",
        },
        notes: c.status === "REJECTED" ? "Odds above the protocol range" : undefined,
      },
      at(18 + i * 2, 12),
    );
  });

  return {
    branches: db.select({ id: branches.id }).from(branches).all().length,
    tickets,
    candidates: candidates.length,
  };
}
