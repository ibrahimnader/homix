class OrderController {


  async getOrders(req, res) {
    const order = await orderService.createOrder(req.body);
    res.status(201).json(order);
  }
}
module.exports = OrderController;