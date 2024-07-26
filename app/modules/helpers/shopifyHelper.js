const shopifyClient = require("../../../config/shopify");
class ShopifyHelper {
  static async importData(path, fields, parameters = {}) {
    const query = {
      limit: 250,
      fields: fields.join(","),
      ...parameters,
    };
    const data = [];
    let response = await shopifyClient.get({
      path,
      query,
    });
    let { body, pageInfo } = response;
    data.push(...body[path]);

    while (
      body[path] &&
      body[path].length > 0 &&
      pageInfo.nextPage &&
      pageInfo.nextPage.query &&
      pageInfo.nextPage.query.page_info
    ) {
      query.page_info = pageInfo.nextPage.query.page_info;

      response = await shopifyClient.get({
        path,
        query,
      });

      body = response.body;
      pageInfo = response.pageInfo;
      data.push(...body[path]);
    }

    return data;
  }
  static async createWebhooks() {
    const webhooks = await shopifyClient.get({
      path: "webhooks",
    });

    for (const webhook of webhooks.body.webhooks) {
      await shopifyClient.delete({
        path: `webhooks/${webhook.id}`,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }
    await Promise.all([
      shopifyClient.post({
        path: "webhooks",
        data: {
          webhook: {
            topic: "orders/create",
            address:`${process.env.APP_URL}/`,
            format: "json",
          },
        },
        type: "application/json",
      }),
      shopifyClient.post({
        path: "webhooks",
        data: {
          webhook: {
            topic: "orders/create",
            address: `${process.env.APP_URL}/`,
            format: "json",
          },
        },
        type: "application/json",
      }),
    ]);
  }
}
module.exports = ShopifyHelper;
