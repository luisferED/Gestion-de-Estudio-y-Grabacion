"""Reconcile only the reviewed 0023 column if a legacy patch added it manually."""


def apply_migration_statement(db, filename, statement):
    if filename == '0023_fixed_schedule_overrides.sql':
        expected = r'ALTER TABLE `reservations` ADD COLUMN `fixed_override` integer DEFAULT false NOT NULL;'
        if statement.strip() != expected:
            raise RuntimeError('Unexpected fixed override migration statement')
        columns = {row[1]: row for row in db.execute('PRAGMA table_info(reservations)')}
        column = columns.get('fixed_override')
        if column is not None:
            default = str(column[4]).strip('()').strip().lower()
            if column[2].upper() != 'INTEGER' or column[3] != 1 or default not in ('0', 'false') or column[5] != 0:
                raise RuntimeError('Existing fixed_override column has an incompatible definition')
            if db.execute('SELECT 1 FROM reservations WHERE fixed_override IS NULL OR fixed_override NOT IN (0,1) LIMIT 1').fetchone():
                raise RuntimeError('Existing fixed_override values are incompatible')
            return
    db.execute(statement)
