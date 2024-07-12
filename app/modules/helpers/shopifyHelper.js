const shopifyClient = require("../../../config/shopify");
class ShopifyHelper {
  static async importData(path, fields) {
    const query = {
      limit: 250,
      fields: fields.join(","),
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
}
module.exports = ShopifyHelper;
