import type { Request, Response } from "express";

import { unwrap } from "../../shared/result";
import type { DashboardService } from "./dashboard.service";

export class DashboardController {
  public constructor(private readonly dashboardService: DashboardService) {}

  public getCards = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getCards(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({
      data: unwrap(result),
      status: true,
    });
  };

  public getFinance = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getFinance(String(request.query.month));
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public saveFinanceOpex = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.saveFinanceOpex(
      String(request.query.month),
      request.body.items as Array<{ amount: number; label: string }>,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public saveFinanceAdjustments = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.saveFinanceAdjustments(
      String(request.query.month),
      request.body.items as Array<{ amount: number; label: string; type: "negative" | "positive" }>,
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getFinanceHistory = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getFinanceHistory(
      String(request.query.endMonth),
      Number(request.query.months),
    );
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getSingleCard = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getSingleCard(
      request.params.cardKey as
        | "activeMakers"
        | "activeProducts"
        | "pendingOrders"
        | "totalOrders"
        | "totalSales",
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({
      data: unwrap(result),
      status: true,
    });
  };

  public getPerformance = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getPerformance(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getActivities = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getActivities(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getLatestOrders = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getLatestOrders(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getLeaderboard = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getLeaderboard(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getQuickActions = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getQuickActions(request.user ?? {}, request.vendorId);
    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getSalesDistribution = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getSalesDistribution(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };

  public getGoalsProgress = async (request: Request, response: Response): Promise<void> => {
    const result = await this.dashboardService.getGoalsProgress(
      request.query as { endDate: string; startDate: string },
      request.user ?? {},
      request.vendorId,
    );

    response.status(200).json({ data: unwrap(result), status: true });
  };
}
