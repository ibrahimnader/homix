import type { IssuesQuery } from "./invoice.issues.schemas";
import { detectInvoiceIssues, summarizeIssues } from "./invoice.issues";
import { InvoiceIssuesRepository, type IssuesLoad } from "./invoice.issues.repo";

type Loader = { load: (filters: IssuesQuery) => Promise<IssuesLoad> };

export class InvoiceIssuesService {
  public constructor(private readonly repo: Loader = new InvoiceIssuesRepository()) {}

  public async find(query: IssuesQuery) {
    const loaded = await this.repo.load(query);
    const issues = detectInvoiceIssues(loaded);
    return { counts: summarizeIssues(issues), issues, scopedInvoices: loaded.scopeInvoiceIds.size, truncated: loaded.truncated };
  }
}
