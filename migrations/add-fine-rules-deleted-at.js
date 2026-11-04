/* Soft delete for fine rules. Deleted rules disappear from the rule list and are never
   applied, but fine_records keep referencing them (the FK stays valid). */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE fine_rules ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ');
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS fine_rules_not_deleted_idx ON fine_rules (id) WHERE "deletedAt" IS NULL');
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS fine_rules_not_deleted_idx');
    await queryInterface.sequelize.query('ALTER TABLE fine_rules DROP COLUMN IF EXISTS "deletedAt"');
  },
};
