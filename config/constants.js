const USER_TYPES = {
  ADMIN: "1",
  VENDOR: "2",
};
const ORDER_STATUS = {
  PENDING : 1,
  IN_PROGRESS: 2,
  HALF_COMPLETED: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  REFUNDED: 6,
  REPLACED: 7,
};
const ORDER_LINE__ITEM_STATUS = {
  NOT_COMPLETED: 1,
  COMPLETED: 2,
  REJECTED: 3,
};
const ORDER_LINE_STATUS = {
  IN_PROGRESS: 1,
  REJECTED: 2,
  READY_FOR_DELIVERY: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
};
const PAYMENT_STATUS = {
  COD: 1,
  PAID: 2,
};
const FACTORY_STATUS = {
  ONLINE: 1,
  OFFLINE: 2,
};
module.exports = {
  USER_TYPES,
  ORDER_STATUS,
  PAYMENT_STATUS,
  FACTORY_STATUS,
  ORDER_LINE_STATUS,
  ORDER_LINE__ITEM_STATUS
};
