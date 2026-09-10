CREATE INDEX `idx_diagnostics_created_at` ON `diagnostics` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_events_session_type` ON `events` (`session_id`,`type`);--> statement-breakpoint
CREATE INDEX `idx_events_type_question` ON `events` (`type`,`question_index`);