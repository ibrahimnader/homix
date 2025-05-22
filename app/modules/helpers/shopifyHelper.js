const shopifyClient = require("../../../config/shopify");
class ShopifyHelper {
  static async importData(
    path,
    fields = [],
    parameters = {},
    callbackFunction
  ) {
    const data = [];
    if (path === "orders") {
      const query = {
        limit: 1,
        fields: fields.join(","),
      };
      let response = await shopifyClient.get({
        path,
        query: {
          ...query,
          ...{
            ...parameters,
          },
        },
      });
      let { body, pageInfo } = response;
      if (callbackFunction) {
        console.log("processing ", path);
        await callbackFunction(body[path]);
        console.log("saved 250 ", path);
      } else {
        data.push(...body[path]);
      }
    } else {
      const query = {
        limit: 250,
        fields: fields.join(","),
      };
      let response = await shopifyClient.get({
        path,
        query: {
          ...query,
          ...parameters,
        },
      });
      let { body, pageInfo } = response;
      if (callbackFunction) {
        console.log("processing ", path);
        await callbackFunction(body[path]);
        console.log("saved 250 ", path);
      } else {
        data.push(...body[path]);
      }

      while (
        body[path] &&
        body[path].length > 0 &&
        pageInfo.nextPage &&
        pageInfo.nextPage.query &&
        pageInfo.nextPage.query.page_info
      ) {
        //wait for 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));

        query.page_info = pageInfo.nextPage.query.page_info;

        response = await shopifyClient.get({
          path,
          query,
        });

        body = response.body;
        pageInfo = response.pageInfo;

        if (callbackFunction) {
          await callbackFunction(body[path]);
          console.log("saved 250 ", path);
        } else {
          data.push(...body[path]);
        }
      }
    }

    return data;
  }
  static async createWebhooks() {
    // const webhooks = await shopifyClient.get({
    //   path: "webhooks",
    // });

    // for (const webhook of webhooks.body.webhooks) {
    //   await shopifyClient.delete({
    //     path: `webhooks/${webhook.id}`,
    //     headers: {
    //       "Content-Type": "application/json",
    //     },
    //   });
    // }
    // const res = await Promise.all([
    //   shopifyClient.post({
    //     path: "webhooks",
    //     data: {
    //       webhook: {
    //         topic: "orders/create",
    //         address: `${process.env.APP_URL}/orders`,
    //         format: "json",
    //       },
    //     },
    //     type: "application/json",
    //   }),
    //   shopifyClient.post({
    //     path: "webhooks",
    //     data: {
    //       webhook: {
    //         topic: "products/create",
    //         address: `${process.env.APP_URL}/products`,
    //         format: "json",
    //       },
    //     },
    //     type: "application/json",
    //   }),
    // ]);
    console.log("Webhooks created successfully");
  }
  static splitArrayToChunks(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

module.exports = ShopifyHelper;
