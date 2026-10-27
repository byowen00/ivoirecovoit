-- Données de référence (production comprise). Idempotent : peut être rejoué.

INSERT INTO cancellation_policies (code, label, rules) VALUES
  ('FLEXIBLE', 'Flexible',
   '{"passenger":[{"minHoursBefore":24,"refundPercent":100},{"minHoursBefore":2,"refundPercent":100},{"minHoursBefore":0,"refundPercent":50}],"serviceFeeRefundableWithinMinutes":15}'),
  ('STANDARD', 'Standard',
   '{"passenger":[{"minHoursBefore":24,"refundPercent":100},{"minHoursBefore":2,"refundPercent":50},{"minHoursBefore":0,"refundPercent":0}],"serviceFeeRefundableWithinMinutes":15}'),
  ('STRICT', 'Stricte',
   '{"passenger":[{"minHoursBefore":24,"refundPercent":50},{"minHoursBefore":2,"refundPercent":0},{"minHoursBefore":0,"refundPercent":0}],"serviceFeeRefundableWithinMinutes":15}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO staff_roles (code, label, permissions) VALUES
  ('SUPPORT', 'Agent de support',
   '{users.read,trips.read,bookings.read,payments.read,disputes.manage,reports.manage,refunds.create.capped,users.moderate.short}'),
  ('ADMIN', 'Administrateur',
   '{users.read,users.read_sensitive,users.moderate,documents.view,verifications.read,verifications.decide,trips.read,trips.moderate,bookings.read,payments.read,refunds.create,refunds.approve,finance.read,disputes.manage,reports.manage,settings.read,settings.write,settings.fees,promotions.manage,places.manage,stats.read,audit.read}'),
  ('FINANCE', 'Finance',
   '{users.read,trips.read,bookings.read,payments.read,refunds.create,refunds.approve,finance.read,finance.payouts,finance.reconcile,exports.create,stats.read}'),
  ('SUPER_ADMIN', 'Super-administrateur', '{*}')
ON CONFLICT (code) DO NOTHING;

-- Paramètres par défaut (doc 05). Valeurs paramétrables, non définitives.
INSERT INTO settings (key, value, version) VALUES
  ('booking.hold_minutes', '15', 1),
  ('booking.hold_extension_minutes', '10', 1),
  ('booking.min_minutes_before_departure', '30', 1),
  ('booking.manual_acceptance_hours', '12', 1),
  ('booking.max_pending_per_passenger', '3', 1),
  ('booking.max_seats_per_booking', '4', 1),
  ('trip.min_minutes_before_publish', '30', 1),
  ('trip.max_days_ahead', '90', 1),
  ('trip.price_min_xof', '500', 1),
  ('trip.price_max_xof', '30000', 1),
  ('payments.cash_enabled', 'false', 1),
  ('payments.enabled_methods', '["WAVE","ORANGE_MONEY","MTN_MOMO","MOOV_MONEY"]', 1),
  ('reviews.window_days', '14', 1),
  ('disputes.window_days', '7', 1),
  ('safety.emergency_numbers',
   '{"_status":"À VALIDER avant production","numbers":[{"label":"Police secours","phone":"110"},{"label":"Police secours","phone":"111"},{"label":"Gendarmerie","phone":"170"},{"label":"Sapeurs-pompiers","phone":"180"},{"label":"SAMU","phone":"185"}]}', 1)
ON CONFLICT (key, version) DO NOTHING;
