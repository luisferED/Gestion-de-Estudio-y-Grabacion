-- Enforce the shared resource and 15-minute recording buffer under concurrent requests.

CREATE TRIGGER IF NOT EXISTS reservations_no_overlap_insert
BEFORE INSERT ON reservations
WHEN NEW.status NOT IN ('cancelada','denegada')
BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_TIME_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.id != NEW.id
      AND r.date = NEW.date AND r.location_type = NEW.location_type
      AND r.status NOT IN ('cancelada','denegada')
      AND (CAST(substr(NEW.start_time,1,2) AS INTEGER)*60 + CAST(substr(NEW.start_time,4,2) AS INTEGER))
          < (CAST(substr(r.end_time,1,2) AS INTEGER)*60 + CAST(substr(r.end_time,4,2) AS INTEGER)
             + CASE WHEN lower(r.usage_category) IN ('grabación','grabacion') THEN 15 ELSE 0 END)
      AND (CAST(substr(NEW.end_time,1,2) AS INTEGER)*60 + CAST(substr(NEW.end_time,4,2) AS INTEGER)
             + CASE WHEN lower(NEW.usage_category) IN ('grabación','grabacion') THEN 15 ELSE 0 END)
          > (CAST(substr(r.start_time,1,2) AS INTEGER)*60 + CAST(substr(r.start_time,4,2) AS INTEGER))
  );
END;

CREATE TRIGGER IF NOT EXISTS reservations_no_overlap_update
BEFORE UPDATE OF date, location_type, start_time, end_time, usage_category, status ON reservations
WHEN NEW.status NOT IN ('cancelada','denegada')
  AND (
    OLD.status IN ('cancelada','denegada')
    OR NEW.date IS NOT OLD.date
    OR NEW.location_type IS NOT OLD.location_type
    OR NEW.start_time IS NOT OLD.start_time
    OR NEW.end_time IS NOT OLD.end_time
    OR NEW.usage_category IS NOT OLD.usage_category
  )
BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_TIME_CONFLICT')
  WHERE EXISTS (
    SELECT 1 FROM reservations r
    WHERE r.id != NEW.id
      AND r.date = NEW.date AND r.location_type = NEW.location_type
      AND r.status NOT IN ('cancelada','denegada')
      AND (CAST(substr(NEW.start_time,1,2) AS INTEGER)*60 + CAST(substr(NEW.start_time,4,2) AS INTEGER))
          < (CAST(substr(r.end_time,1,2) AS INTEGER)*60 + CAST(substr(r.end_time,4,2) AS INTEGER)
             + CASE WHEN lower(r.usage_category) IN ('grabación','grabacion') THEN 15 ELSE 0 END)
      AND (CAST(substr(NEW.end_time,1,2) AS INTEGER)*60 + CAST(substr(NEW.end_time,4,2) AS INTEGER)
             + CASE WHEN lower(NEW.usage_category) IN ('grabación','grabacion') THEN 15 ELSE 0 END)
          > (CAST(substr(r.start_time,1,2) AS INTEGER)*60 + CAST(substr(r.start_time,4,2) AS INTEGER))
  );
END;
