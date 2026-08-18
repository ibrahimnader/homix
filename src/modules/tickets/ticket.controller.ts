import type { Request, Response } from "express";

import { unwrap } from "../../shared/result";
import type { TicketService } from "./ticket.service";

export class TicketController {
  public constructor(private readonly ticketService: TicketService) {}

  public getMeta = async (_request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.getMeta();
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public updateSettings = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.updateSettings(request.body);
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public lookupOrderByOperationNumber = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.lookupOrderByOperationNumber(
      String(request.query.operationNumber ?? ""),
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public lookupOrderByOrderNumber = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.lookupOrderByOrderNumber(
      String(request.query.orderNumber ?? ""),
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public createTicket = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.createTicket(
      request.body,
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(201).json({ data: unwrap(result), status: true });
  };

  public listTickets = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.listTickets(request.query as never, request.vendorId);
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public exportTickets = async (request: Request, response: Response): Promise<void> => {
    await this.ticketService.exportTickets(response, request.query as never, request.vendorId);
  };

  public getTicketById = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.getTicketById(Number(request.params.ticketId), request.vendorId);
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public updateTicket = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.updateTicket(
      Number(request.params.ticketId),
      request.body,
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public deleteTicket = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.deleteTicket(
      Number(request.params.ticketId),
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(200).json({ ...unwrap(result), status: true });
  };

  public addNote = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.addNote(
      Number(request.params.ticketId),
      request.body,
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(201).json({ data: unwrap(result), status: true });
  };

  public updateNote = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.updateNote(
      Number(request.params.ticketId),
      Number(request.params.noteId),
      request.body,
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public deleteNote = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.deleteNote(
      Number(request.params.ticketId),
      Number(request.params.noteId),
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public addAttachments = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.addAttachments(
      Number(request.params.ticketId),
      request.filePaths ?? [],
      request.fileNames ?? [],
      request.descriptions ?? [],
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(201).json({ data: unwrap(result), status: true });
  };

  public deleteAttachment = async (request: Request, response: Response): Promise<void> => {
    const result = await this.ticketService.deleteAttachment(
      Number(request.params.ticketId),
      Number(request.params.attachmentId),
      request.user ?? { id: 0 },
      request.vendorId,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };
}
