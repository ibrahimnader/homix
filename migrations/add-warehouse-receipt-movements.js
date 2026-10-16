module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS warehouse_receipt_movements (
        id BIGSERIAL PRIMARY KEY,
        "orderId" INTEGER NOT NULL REFERENCES orders(id),
        "inventoryItemId" INTEGER NOT NULL REFERENCES "shipmentInventoryItems"(id),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        "previousStatus" INTEGER,
        "previousShipmentStatus" INTEGER,
        "previousDeliveryBy" INTEGER,
        "previousShippedFromInventory" BOOLEAN,
        "previousShippingReceiveDate" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "cancelledAt" TIMESTAMPTZ
      )
    `);
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS warehouse_receipt_movements_active_idx ON warehouse_receipt_movements ("orderId") WHERE "cancelledAt" IS NULL');
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS warehouse_receipt_movements');
  },
};
