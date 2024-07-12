const { shopifyApi } = require("@shopify/shopify-api");

require("@shopify/shopify-api/adapters/node");


  const shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_APP_KEY,
    apiSecretKey: process.env.SHOPIFY_APP_SECRET,
    scopes: ["read_products", "read_orders"],
    hostName: "ngrok-tunnel-address",
    isCustomStoreApp: true,
    adminApiAccessToken: process.env.SHOPIFY_TOKEN,
  });
  
  const client = new shopify.clients.Rest({
    session: {
      shop: `${process.env.SHOPIFY_STORE}.com`,
      accessToken: process.env.SHOPIFY_STORE,
    },
  });

module.exports = client;
