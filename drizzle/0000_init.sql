CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`related_bet_id` text,
	`amount_cents` integer NOT NULL,
	`created_at` integer NOT NULL,
	`type` text NOT NULL,
	`harvest_kind` text,
	`profile` text NOT NULL,
	`destination` text DEFAULT 'UNALLOCATED' NOT NULL,
	`notes` text,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_amount_positive" CHECK("bank_transactions"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `bank_branch_idx` ON `bank_transactions` (`branch_id`);--> statement-breakpoint
CREATE INDEX `bank_created_at_idx` ON `bank_transactions` (`created_at`);--> statement-breakpoint
CREATE TABLE `bets` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`round_number` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	`event_date` text NOT NULL,
	`event_time` text,
	`sport` text NOT NULL,
	`competition` text NOT NULL,
	`event_name` text NOT NULL,
	`event_key` text NOT NULL,
	`home_team` text,
	`away_team` text,
	`market_name` text NOT NULL,
	`selection` text NOT NULL,
	`bookmaker` text DEFAULT 'WINAMAX' NOT NULL,
	`odds_bp` integer NOT NULL,
	`stake_cents` integer NOT NULL,
	`potential_return_cents` integer NOT NULL,
	`result` text DEFAULT 'PENDING' NOT NULL,
	`actual_return_cents` integer,
	`profit_loss_cents` integer,
	`capital_before_cents` integer NOT NULL,
	`capital_after_cents` integer,
	`counts_as_round` integer,
	`closing_odds_bp` integer,
	`notes` text,
	`protocol_status` text,
	`confidence` integer,
	`checklist` text,
	`screenshot_path` text,
	`override_reason` text,
	`cancelled_at` integer,
	`cancel_reason` text,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bets_stake_positive" CHECK("bets"."stake_cents" > 0),
	CONSTRAINT "bets_odds_above_one" CHECK("bets"."odds_bp" > 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bets_branch_sequence_uq` ON `bets` (`branch_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `bets_one_pending_per_branch_uq` ON `bets` (`branch_id`) WHERE result = 'PENDING' AND cancelled_at IS NULL;--> statement-breakpoint
CREATE INDEX `bets_event_key_idx` ON `bets` (`event_key`);--> statement-breakpoint
CREATE INDEX `bets_result_idx` ON `bets` (`result`);--> statement-breakpoint
CREATE INDEX `bets_created_at_idx` ON `bets` (`created_at`);--> statement-breakpoint
CREATE TABLE `branch_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	`amount_cents` integer,
	`capital_delta_cents` integer DEFAULT 0 NOT NULL,
	`capital_after_cents` integer,
	`status_after` text,
	`related_bet_id` text,
	`related_branch_id` text,
	`metadata` text,
	`description` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_branch_idx` ON `branch_events` (`branch_id`);--> statement-breakpoint
CREATE INDEX `events_created_at_idx` ON `branch_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `branch_events` (`type`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`parent_id` text,
	`generation` integer NOT NULL,
	`profile` text NOT NULL,
	`status` text NOT NULL,
	`birth_reason` text NOT NULL,
	`birth_bet_id` text,
	`birth_event_id` integer,
	`birth_capital_cents` integer NOT NULL,
	`current_capital_cents` integer NOT NULL,
	`cap_cents` integer NOT NULL,
	`peak_capital_cents` integer NOT NULL,
	`p1_done` integer DEFAULT false NOT NULL,
	`threshold_level` integer DEFAULT 0 NOT NULL,
	`total_bank_generated_cents` integer DEFAULT 0 NOT NULL,
	`total_child_capital_generated_cents` integer DEFAULT 0 NOT NULL,
	`total_lost_cents` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`voids` integer DEFAULT 0 NOT NULL,
	`round_count` integer DEFAULT 0 NOT NULL,
	`child_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`matured_at` integer,
	`died_at` integer,
	`last_round_at` integer,
	`notes` text,
	FOREIGN KEY (`parent_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`birth_bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "branches_capital_non_negative" CHECK("branches"."current_capital_cents" >= 0),
	CONSTRAINT "branches_birth_capital_positive" CHECK("branches"."birth_capital_cents" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_code_unique` ON `branches` (`code`);--> statement-breakpoint
CREATE INDEX `branches_parent_idx` ON `branches` (`parent_id`);--> statement-breakpoint
CREATE INDEX `branches_status_idx` ON `branches` (`status`);--> statement-breakpoint
CREATE INDEX `branches_profile_idx` ON `branches` (`profile`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`event_date` text NOT NULL,
	`event_time` text,
	`sport` text NOT NULL,
	`competition` text NOT NULL,
	`event_name` text NOT NULL,
	`market_name` text NOT NULL,
	`selection` text NOT NULL,
	`odds_observed_bp` integer NOT NULL,
	`closing_odds_bp` integer,
	`protocol_status` text NOT NULL,
	`result` text DEFAULT 'PENDING' NOT NULL,
	`checklist` text,
	`notes` text,
	`converted_bet_id` text,
	`archived_at` integer,
	FOREIGN KEY (`converted_bet_id`) REFERENCES `bets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `candidates_event_date_idx` ON `candidates` (`event_date`);--> statement-breakpoint
CREATE TABLE `settings_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data` text NOT NULL,
	`changed_at` integer NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `strategy_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
