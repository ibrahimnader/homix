import type { Request, Response } from "express";

import { unwrap } from "../../../src/shared/result";
import type { CustomerCreateInput, CustomerListQuery, CustomerUpdateInput } from "./customer.schemas";

const CustomerService = require("./customer.service") as typeof import("./customer.service");

class CustomerController {
  public static async updateCustomer(req: Request, res: Response): Promise<void> {
    const result = await CustomerService.updateCustomer(
      Number(req.params.customerId),
      req.body as CustomerUpdateInput,
    );

    res.status(200).json({
      data: unwrap(result),
      status: true,
    });
  }

  public static async listCustomers(req: Request, res: Response): Promise<void> {
    const result = await CustomerService.listCustomers(req.query as never as CustomerListQuery);
    res.status(200).json({ data: unwrap(result), status: true });
  }

  public static async getSummary(_req: Request, res: Response): Promise<void> {
    const result = await CustomerService.getCustomersSummary();
    res.status(200).json({ data: unwrap(result), status: true });
  }

  public static async createCustomer(req: Request, res: Response): Promise<void> {
    const result = await CustomerService.createCustomer(req.body as CustomerCreateInput);
    res.status(201).json({ data: unwrap(result), status: true });
  }

  public static async exportCustomers(req: Request, res: Response): Promise<void> {
    await CustomerService.exportCustomers(res, req.query as never as CustomerListQuery);
  }
}

export = CustomerController;
