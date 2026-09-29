CREATE TABLE `api_calls` (
	`api` text NOT NULL,
	`day` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`limit_reached_at` integer,
	PRIMARY KEY(`api`, `day`)
);
--> statement-breakpoint
CREATE TABLE `skipped_items` (
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`skipped_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `external_id`)
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `cautions` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `ebay_daily_call_budget` integer DEFAULT 4000 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `skip_suppression_days` integer DEFAULT 30 NOT NULL;