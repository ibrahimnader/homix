const { connectToDb } = require("../../config/db.config");
const shopifyClient = require("../../config/shopify");
const { saveImportedProducts } = require("../modules/product/product.service");

async function main() {
  await connectToDb();
  await importData("  ");
  console.log("Products imported successfully");
}
async function importData(path) {
  const query = {
    limit: 250,
  };
  let response = await shopifyClient.get({
    path : "collections",
  });
  let { body, pageInfo } = response;
  // await saveImportedProducts(body[path]);
  console.log("Chunk of products imported");
  // while (
  //   body[path] &&
  //   body[path].length > 0 &&
  //   pageInfo.nextPage &&
  //   pageInfo.nextPage.query &&
  //   pageInfo.nextPage.query.page_info
  // ) {
  //   query.page_info = pageInfo.nextPage.query.page_info;

  //   response = await shopifyClient.get({
  //     path,
  //     query,
  //   });

  //   body = response.body;
  //   pageInfo = response.pageInfo;
  //   await saveImportedProducts(body[path]);
  //   console.log("Chunk of products imported");
  // }
}

main();
