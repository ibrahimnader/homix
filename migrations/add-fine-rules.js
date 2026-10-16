module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS fine_rules (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        trigger TEXT NOT NULL CHECK (trigger IN ('delivery_delay','late_cancellation','customer_refusal','manual')),
        "amountType" TEXT NOT NULL CHECK ("amountType" IN ('fixed','percent')),
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        frequency TEXT NOT NULL CHECK (frequency IN ('once','daily')),
        basis TEXT NOT NULL CHECK (basis IN ('subtotal','total','commission','cost')),
        "graceHours" INTEGER NOT NULL DEFAULT 0 CHECK ("graceHours" >= 0),
        "maxAmount" NUMERIC(14,2) CHECK ("maxAmount" >= 0),
        "effectiveFrom" TIMESTAMPTZ NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS fine_records (
        id BIGSERIAL PRIMARY KEY,
        "ruleId" BIGINT NOT NULL REFERENCES fine_rules(id),
        "orderId" INTEGER NOT NULL REFERENCES orders(id),
        amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
        "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "waivedAt" TIMESTAMPTZ,
        "waiveReason" TEXT,
        "waivedBy" INTEGER REFERENCES users(id),
        CONSTRAINT fine_records_unique_rule_order UNIQUE ("ruleId", "orderId")
      )
    `);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS fine_records_applied_idx ON fine_records ("appliedAt" DESC)');
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS fine_records');
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS fine_rules');
  },
};
