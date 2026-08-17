import type { Request, Response } from "express";

import { unwrap } from "../../shared/result";
import type { ShipmentService } from "./shipment.service";

export class ShipmentController {
  public constructor(private readonly shipmentService: ShipmentService) {}

  public createShipment = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.createShipment(request.body)), status: true });
  };

  public getMeta = async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.getMeta()), status: true });
  };

  public getSummary = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.getSummary(request.query as never, request.vendorId)), status: true });
  };

  public listShipments = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listShipments(request.query as never, request.vendorId)), status: true });
  };

  public getShipmentById = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.getShipmentById(Number(request.params.shipmentId), request.vendorId)), status: true });
  };

  public listVendorReturns = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listVendorReturns(request.query as never, request.vendorId)), status: true });
  };

  public listCustomerReturns = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listCustomerReturns(request.query as never, request.vendorId)), status: true });
  };

  public exportVendorReturns = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportReturns(response, "vendor", request.query as never, request.vendorId);
  };

  public exportCustomerReturns = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportReturns(response, "customer", request.query as never, request.vendorId);
  };

  public createVendorReturn = async (request: Request, response: Response): Promise<void> => {
    response.status(201).json({
      data: unwrap(await this.shipmentService.createVendorReturn(request.body, request.user ?? { id: 0 })),
      status: true,
    });
  };

  public createCustomerReturn = async (request: Request, response: Response): Promise<void> => {
    response.status(201).json({
      data: unwrap(await this.shipmentService.createCustomerReturn(request.body, request.user ?? { id: 0 })),
      status: true,
    });
  };

  public updateVendorReturn = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateVendorReturn(Number(request.params.returnId), request.body, request.user ?? { id: 0, userType: "" })),
      status: true,
    });
  };

  public updateCustomerReturn = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateCustomerReturn(
        Number(request.params.returnId),
        request.body,
        request.user ?? { id: 0 },
      )),
      status: true,
    });
  };

  public listInventory = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listInventory(request.query as never, request.vendorId)), status: true });
  };

  public exportInventory = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportInventory(response, request.query as never, request.vendorId);
  };

  public createInventoryItem = async (request: Request, response: Response): Promise<void> => {
    response.status(201).json({ data: unwrap(await this.shipmentService.createInventoryItem(request.body)), status: true });
  };

  public updateInventoryItem = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateInventoryItem(Number(request.params.inventoryItemId), request.body)),
      status: true,
    });
  };

  public deleteInventoryItem = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.deleteInventoryItem(Number(request.params.inventoryItemId))), status: true });
  };

  public listDeliveryAccounts = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listDeliveryAccounts(request.query as never, request.vendorId)), status: true });
  };

  public exportDeliveryAccounts = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportDeliveryAccounts(response, request.query as never, request.vendorId);
  };

  public updateDeliveryAccount = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.updateDeliveryAccount(Number(request.params.orderId), request.body)), status: true });
  };

  public bulkUpdateDeliveryAccounts = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.bulkUpdateDeliveryAccounts(request.body.orderIds, request.body.data)),
      status: true,
    });
  };

  public listExpenseAccounts = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listExpenseAccounts(request.query as never)), status: true });
  };

  public exportExpenseAccounts = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportExpenseAccounts(response, request.query as never);
  };

  public createExpenseAccount = async (request: Request, response: Response): Promise<void> => {
    response.status(201).json({ data: unwrap(await this.shipmentService.createExpenseAccount(request.body)), status: true });
  };

  public updateExpenseTypes = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.updateExpenseTypes(request.body.options)), status: true });
  };

  public listShippingCompanies = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.listShippingCompanies(request.query.search as string | undefined)), status: true });
  };

  public createShippingCompany = async (request: Request, response: Response): Promise<void> => {
    response.status(201).json({ data: unwrap(await this.shipmentService.createShippingCompany(request.body)), status: true });
  };

  public updateShippingCompany = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateShippingCompany(Number(request.params.shippingCompanyId), request.body)),
      status: true,
    });
  };

  public deleteShippingCompany = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      ...unwrap(await this.shipmentService.deleteShippingCompany(Number(request.params.shippingCompanyId))),
      status: true,
    });
  };

  public updateExpenseAccount = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateExpenseAccount(Number(request.params.expenseId), request.body)),
      status: true,
    });
  };

  public deleteExpenseAccount = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.deleteExpenseAccount(Number(request.params.expenseId))), status: true });
  };

  public getPerformance = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.getPerformance(request.query as never, request.vendorId)), status: true });
  };

  public exportPerformance = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportPerformance(response, request.query as never, request.vendorId);
  };

  public exportShipments = async (request: Request, response: Response): Promise<void> => {
    await this.shipmentService.exportShipments(
      response,
      request.vendorId ? { ...request.query, vendorId: String(request.vendorId), vendorUser: true } : request.query,
    );
  };

  public updateShipment = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.updateShipment(
        Number(request.params.shipmentId),
        request.body,
        request.user ?? { id: 0 },
      )),
      status: true,
    });
  };

  public bulkUpdateShipments = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(await this.shipmentService.bulkUpdateShipments(
        request.body.shipmentIds,
        request.body.data,
        request.user ?? { id: 0 },
      )),
      status: true,
    });
  };

  public deleteShipment = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.deleteShipment(Number(request.params.shipmentId))), status: true });
  };

  public addNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.addNote(Number(request.params.shipmentId), request.body.text ?? "", request.user ?? { id: 0 })), status: true });
  };

  public updateNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.shipmentService.updateNote(Number(request.params.shipmentId), Number(request.params.noteId), request.body.text ?? "", request.user ?? { id: 0 })), status: true });
  };

  public deleteNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.shipmentService.deleteNote(Number(request.params.shipmentId), Number(request.params.noteId), request.user ?? { id: 0 })), status: true });
  };
}
