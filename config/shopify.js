const { shopifyApi } = require("@shopify/shopify-api");

require("@shopify/shopify-api/adapters/node");

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_APP_KEY,
  apiSecretKey: process.env.SHOPIFY_APP_SECRET,
  scopes: [
    "read_products",
    "read_orders",
    "read_customers",
    "read_all_orders ",
    "read_inventory",
  ],
  hostName: "ngrok-tunnel-address",
  isCustomStoreApp: true,
  adminApiAccessToken: process.env.SHOPIFY_TOKEN,
  customerAddressDefaultFix: true,
  //specify the api version
  apiVersion: "2024-07",
});

const shopifyClient = new shopify.clients.Rest({
  session: {
    shop: `${process.env.SHOPIFY_STORE}.com`,
    accessToken: process.env.SHOPIFY_STORE,
  },
});

module.exports = shopifyClient;
