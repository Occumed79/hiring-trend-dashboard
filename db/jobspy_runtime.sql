-- Supplemental-source ranking used only when two active rows share the same
-- normalized apply URL. Higher-value official sources always win.
-- Idempotent so Render build migrations can safely reapply it.

CREATE OR REPLACE FUNCTION source_preference(source_name TEXT)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN source_name = 'jobapi:theirstack' THEN 80
    WHEN source_name LIKE 'jobspy:%' THEN 70
    WHEN source_name = 'web:keenable' THEN 60
    WHEN source_name = 'web:tinyfish' THEN 55
    WHEN source_name = 'web:langsearch' THEN 50
    ELSE 100
  END;
$$;
