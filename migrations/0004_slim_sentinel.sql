DROP INDEX `idx_events_type_question`;--> statement-breakpoint
CREATE INDEX `idx_events_type_question` ON `events` (`type`,`question_index`,`session_id`);