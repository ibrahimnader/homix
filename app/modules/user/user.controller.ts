import type { Request, Response } from "express";

const UserService = require("./user.service") as typeof import("./user.service");

const getId = (req: Request): string => {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] ?? "" : id ?? "";
};

class UserController {
  public static async getMeta(_req: Request, res: Response): Promise<Response> {
    try {
      const meta = await UserService.getMeta();
      return res.status(200).json(meta);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch user meta";
      return res.status(500).json({ message });
    }
  }

  public static async getAllUsers(req: Request, res: Response): Promise<Response> {
    try {
      /* The default list is the team (admins, operations, logistics): it feeds pickers such as the account manager.
         The Users screen asks for `?includeVendors=true` to also manage the vendors' login accounts. */
      const includeVendors = String(req.query?.includeVendors ?? "").toLowerCase() === "true";
      const users = includeVendors ? await UserService.getAllUsers() : await UserService.getAdminUsers();
      return res.status(200).json(users);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch users";
      return res.status(500).json({ message });
    }
  }

  /**
   * The caller's own record. Sessions are stored in the browser, so a session
   * created before a field was added (permissions, for example) keeps serving a
   * stale user object until the token expires. The client refreshes itself from
   * here on boot instead of forcing everyone to sign in again after a deploy.
   *
   * Auth only — it never takes an id, so it cannot read anyone else's record.
   */
  public static async getCurrentUser(req: Request, res: Response): Promise<Response> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized", status: false });
      }

      const user = await UserService.getUser(String(userId));
      return res.status(200).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch user";
      return res.status(500).json({ message });
    }
  }

  public static async getUser(req: Request, res: Response): Promise<Response> {
    try {
      const user = await UserService.getUser(getId(req));
      return res.status(200).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch user";
      return res.status(500).json({ message });
    }
  }

  public static async editUser(req: Request, res: Response): Promise<Response> {
    try {
      const user = await UserService.editUser(getId(req), req.body as Record<string, unknown>, Number(req.user?.id ?? 0));
      return res.status(200).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to edit user";
      return res.status(500).json({ message });
    }
  }

  public static async updateStatus(req: Request, res: Response): Promise<Response> {
    try {
      const user = await UserService.updateStatus(
        getId(req),
        String((req.body as { accountStatus?: string }).accountStatus ?? ""),
        Number(req.user?.id ?? 0),
      );
      return res.status(user.statusCode).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update user status";
      return res.status(500).json({ message });
    }
  }

  public static async deleteUser(req: Request, res: Response): Promise<Response> {
    try {
      const user = await UserService.deleteUser(getId(req), Number(req.user?.id ?? 0));
      return res.status(200).json(user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete user";
      return res.status(500).json({ message });
    }
  }
}

export = UserController;
