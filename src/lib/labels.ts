import type {
  BankDestination,
  BetResult,
  BranchEventType,
  BranchStatus,
  ChecklistItem,
  HarvestKind,
  Profile,
} from "@/domain/types";

export const PROFILE_LABEL: Record<Profile, string> = {
  HARVEST: "Harvest",
  BALANCED: "Balanced",
  GROWTH: "Growth",
};

export const PROFILE_DESCRIPTION: Record<Profile, string> = {
  HARVEST: "Aggressive harvesting — frequent splits, low cap",
  BALANCED: "Balanced — moderate splits and cap",
  GROWTH: "Aggressive growth — rare splits, high cap",
};

/** CSS variable holding each profile's hue (validated palette). */
export const PROFILE_COLOR_VAR: Record<Profile, string> = {
  HARVEST: "var(--harvest)",
  BALANCED: "var(--balanced)",
  GROWTH: "var(--growth)",
};

/** Literal hues for canvas/SVG contexts that cannot resolve CSS variables (minimap). */
export const PROFILE_HEX: Record<Profile, string> = {
  HARVEST: "#1f9d6c",
  BALANCED: "#4597ea",
  GROWTH: "#8f42d8",
};
export const DEAD_HEX = "#4d5361";

export const STATUS_LABEL: Record<BranchStatus, string> = {
  ACTIVE: "Active",
  MATURE: "Mature",
  DEAD: "Dead",
  PAUSED: "Paused",
};

export const RESULT_LABEL: Record<BetResult, string> = {
  PENDING: "Pending",
  WON: "Won",
  LOST: "Lost",
  VOID: "Void",
};

export const EVENT_LABEL: Record<BranchEventType, string> = {
  BIRTH: "Birth",
  BET_CREATED: "Round opened",
  BET_WON: "Won",
  BET_LOST: "Lost",
  BET_VOID: "Void",
  BET_CANCELLED: "Ticket cancelled",
  HARVEST: "Harvest",
  BANK_TRANSFER: "BANK transfer",
  SPLIT: "Split",
  CHILD_CREATED: "Child created",
  CAP_REACHED: "Cap reached",
  PROFILE_CHANGED: "Profile changed",
  STATUS_CHANGED: "Status changed",
  MANUAL_ADJUSTMENT: "Manual adjustment",
  DEATH: "Death",
};

export const HARVEST_LABEL: Record<HarvestKind, string> = {
  P1: "P1",
  THRESHOLD: "Threshold",
  MATURE_PROFIT: "Mature profit",
};

export const DESTINATION_LABEL: Record<BankDestination, string> = {
  UNALLOCATED: "Unallocated",
  LIVRET_A: "Livret A",
  PEA: "PEA",
  CTO: "CTO",
  OTHER: "Other",
};

export const CHECKLIST_LABEL: Record<ChecklistItem, string> = {
  singleMatch: "Single match (mandatory)",
  preMatch: "Pre-match (not live)",
  oddsInRange: "Odds within protocol range",
  teamStrengthGap: "Clear strength gap",
  homeAdvantage: "Home advantage",
  lineupKnown: "Line-up known",
  noMajorInjuries: "No major injuries",
  motivationContextOK: "Motivation context OK",
  scheduleContextOK: "Schedule / fatigue OK",
  marketPriceOK: "Market price OK",
  noCorrelation: "No correlation with other branches",
  noRedFlag: "No red flag",
};
