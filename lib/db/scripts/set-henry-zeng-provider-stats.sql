-- One-off: Henry Zeng service provider — verified badge + recommendation count (run in SQL editor or psql)
-- Adjust full_name if your profile uses a different spelling.

UPDATE profiles
SET is_verified = true
WHERE full_name = 'Henry Zeng'
  AND role = 'service_provider';

UPDATE service_provider_profiles AS sp
SET recommendation_count = 324
FROM profiles AS p
WHERE sp.user_id = p.id
  AND p.full_name = 'Henry Zeng'
  AND p.role = 'service_provider';
