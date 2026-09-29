PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`category` text,
	`size` text,
	`color` text,
	`material` text,
	`thread_count` integer,
	`condition` text,
	`lot_price_cents` integer NOT NULL,
	`lot_size` integer,
	`lots_available` integer NOT NULL,
	`shipping_cents` integer,
	`status` text NOT NULL,
	`matched_spec_id` integer,
	`proposed_lots` integer,
	`note` text,
	`decided_by` text,
	`decided_at` integer,
	`checkout_expired_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_spec_id`) REFERENCES `specs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_listings`("id", "source_id", "external_id", "title", "url", "category", "size", "color", "material", "thread_count", "condition", "lot_price_cents", "lot_size", "lots_available", "shipping_cents", "status", "matched_spec_id", "proposed_lots", "note", "decided_by", "decided_at", "checkout_expired_at", "first_seen_at", "last_seen_at") SELECT "id", "source_id", "external_id", "title", "url", "category", "size", "color", "material", "thread_count", "condition", "lot_price_cents", "lot_size", "lots_available", "shipping_cents", "status", "matched_spec_id", "proposed_lots", "note", "decided_by", "decided_at", "checkout_expired_at", "first_seen_at", "last_seen_at" FROM `listings`;--> statement-breakpoint
DROP TABLE `listings`;--> statement-breakpoint
ALTER TABLE `__new_listings` RENAME TO `listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `listings_source_external_uq` ON `listings` (`source_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`);--> statement-breakpoint
ALTER TABLE `settings` ADD `ship_to_zip` text DEFAULT '37203' NOT NULL;