-- Phase 8b: a serf's permanent class (D-072, D-073). Null while it is still
-- a plain Serf; set once at level 5 and never changed. The class names are
-- validated by the server (shared CLASS_IDS); this only keeps them sane.

alter table serfs add column class_id text check (class_id ~ '^[a-z]{1,32}$');
