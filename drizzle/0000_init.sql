CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`actor` text NOT NULL,
	`listing_id` integer,
	`order_id` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_created_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`category` text NOT NULL,
	`size` text,
	`color` text NOT NULL,
	`material` text NOT NULL,
	`thread_count` integer,
	`condition` text NOT NULL,
	`lot_price_cents` integer NOT NULL,
	`lot_size` integer NOT NULL,
	`lots_available` integer NOT NULL,
	`shipping_cents` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`matched_spec_id` integer,
	`proposed_lots` integer,
	`note` text,
	`decided_by` text,
	`decided_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_spec_id`) REFERENCES `specs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_source_external_uq` ON `listings` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`spec_id` integer NOT NULL,
	`source_id` text NOT NULL,
	`lots` integer NOT NULL,
	`units` integer NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`mode` text NOT NULL,
	`placed_by` text NOT NULL,
	`external_ref` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`sources_checked` integer DEFAULT 0 NOT NULL,
	`listings_seen` integer DEFAULT 0 NOT NULL,
	`new_listings` integer DEFAULT 0 NOT NULL,
	`matched` integer DEFAULT 0 NOT NULL,
	`auto_bought` integer DEFAULT 0 NOT NULL,
	`queued` integer DEFAULT 0 NOT NULL,
	`blocked` integer DEFAULT 0 NOT NULL,
	`expired` integer DEFAULT 0 NOT NULL,
	`errors` text
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`auto_buy_enabled` integer DEFAULT false NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`weekly_cap_cents` integer NOT NULL,
	`per_order_cap_cents` integer NOT NULL,
	`pending_expiry_minutes` integer NOT NULL,
	`scan_interval_seconds` integer NOT NULL,
	`notify_phone` text,
	`scan_lock_until` integer
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`purchase_method` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_buy_allowed` integer DEFAULT false NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`size` text,
	`color` text DEFAULT 'white' NOT NULL,
	`materials` text NOT NULL,
	`min_thread_count` integer,
	`conditions` text NOT NULL,
	`max_unit_price_cents` integer NOT NULL,
	`target_units` integer NOT NULL,
	`max_units_per_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer
);
