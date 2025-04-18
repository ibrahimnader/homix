const USER_TYPES = {
  ADMIN: "1",
  VENDOR: "2",
  OPERATION: "3",
  LOGISTIC: "4",
};
const ORDER_STATUS = {
  PENDING: 1,
  IN_PROGRESS: 2,
  CONFIRMED: 3,
  CANCELED: 4,
  DELIVERED: 5,
  REFUNDED: 6,
  REPLACED: 7,

  // HALF_COMPLETED: 3,
  // OUT_FOR_DELIVERY: 4,
};
const DELIVERY_STATUS = {
  ON_SCHEDULE: 1,
  ALMOST_LAST: 2,
  LATE: 3,
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
  ORDER_LINE__ITEM_STATUS,
  DELIVERY_STATUS,
};
