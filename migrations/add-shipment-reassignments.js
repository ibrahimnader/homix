module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS shipment_reassignments (
        id BIGSERIAL PRIMARY KEY,
        "sourceOrderId" INTEGER NOT NULL REFERENCES orders(id),
        "targetOrderId" INTEGER NOT NULL REFERENCES orders(id),
        reason TEXT NOT NULL,
        notes TEXT,
        "keepOldPending" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdBy" INTEGER REFERENCES users(id),
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT shipment_reassignments_distinct_orders CHECK ("sourceOrderId" <> "targetOrderId"),
        CONSTRAINT shipment_reassignments_source_unique UNIQUE ("sourceOrderId"),
        CONSTRAINT shipment_reassignments_target_unique UNIQUE ("targetOrderId")
      )
    `);
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS shipment_reassignments_created_idx ON shipment_reassignments ("createdAt" DESC)');
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS shipment_reassignments');
  },
};
