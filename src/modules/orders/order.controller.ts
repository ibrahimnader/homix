import type { Request, Response } from "express";

import { unwrap } from "../../shared/result";
import type { OrderService } from "./order.service";

export class OrderController {
  public constructor(private readonly orderService: OrderService) {}

  public getMeta = async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.getMeta()), status: true });
  };

  public getSummary = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.getSummary(request.query as never, request.vendorId)), status: true });
  };

  public listOrders = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.listOrders(request.query as never, request.vendorId)), status: true });
  };

  public getOrderById = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.getOrderById(Number(request.params.orderId), request.vendorId)), status: true });
  };

  public createOrder = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.orderService.createOrder(request.body, request.user)), status: true });
  };

  public importOrders = async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.orderService.importOrders()), status: true });
  };

  public financialReport = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({
      data: unwrap(
        await this.orderService.financialReport(request.query as never, request.vendorId),
      ),
      status: true,
    });
  };

  public exportFinancialReport = async (request: Request, response: Response): Promise<void> => {
    await this.orderService.exportFinancialReport(response, request.query as never, request.vendorId);
  };

  public updateOrder = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.updateOrder(Number(request.params.orderId), request.body, request.user ?? { id: 0 })), status: true });
  };

  public bulkUpdate = async (request: Request, response: Response): Promise<void> => {
    const result = unwrap(await this.orderService.bulkUpdate(request.body, request.user ?? { id: 0 }));
    response.status(200).json({ ...result, status: true });
  };

  public deleteOrder = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.orderService.deleteOrder(Number(request.params.orderId), request.user ?? { id: 0 })), status: true });
  };

  public bulkDelete = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.orderService.bulkDelete(request.body)), status: true });
  };

  public addNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.addNote(Number(request.params.orderId), request.body.text ?? "", request.user ?? { id: 0 })), status: true });
  };

  public updateNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.updateNote(Number(request.params.orderId), Number(request.params.noteId), request.body.text ?? "", request.user ?? { id: 0 })), status: true });
  };

  public deleteNote = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ ...unwrap(await this.orderService.deleteNote(Number(request.params.orderId), Number(request.params.noteId), request.user ?? { id: 0 })), status: true });
  };

  public uploadFiles = async (request: Request, response: Response): Promise<void> => {
    const result = unwrap(
      await this.orderService.uploadFiles(
        Number(request.params.noteId),
        request.filePaths ?? [],
        request.fileNames ?? [],
        request.descriptions ?? [],
      ),
    );
    response.status(200).json({ ...result, status: true });
  };

  public listSellerChatMessages = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.listSellerChatMessages(Number(request.params.orderId))), status: true });
  };

  public addSellerChatMessage = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.addSellerChatMessage(Number(request.params.orderId), request.body.text ?? "", request.user ?? { id: 0 })), status: true });
  };

  public uploadSellerChatFiles = async (request: Request, response: Response): Promise<void> => {
    const result = unwrap(
      await this.orderService.uploadSellerChatFiles(
        Number(request.params.messageId),
        request.filePaths ?? [],
        request.fileNames ?? [],
        request.descriptions ?? [],
      ),
    );
    response.status(200).json({ ...result, status: true });
  };

  public getSellerChatQuickReplies = async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.getSellerChatQuickReplies()), status: true });
  };

  public updateSellerChatQuickReplies = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json({ data: unwrap(await this.orderService.updateSellerChatQuickReplies(request.body.quickReplies ?? [])), status: true });
  };

  public exportOrders = async (request: Request, response: Response): Promise<void> => {
    const payload = request.vendorId ? { ...request.query, vendorId: String(request.vendorId), vendorUser: true } : request.query;
    await this.orderService.exportOrders(response, payload);
  };
}
