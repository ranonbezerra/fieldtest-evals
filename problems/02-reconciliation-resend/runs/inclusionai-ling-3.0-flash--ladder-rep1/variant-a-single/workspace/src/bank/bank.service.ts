import { Injectable } from "@nestjs/common";
import {
  BankSendRequest,
  BankSendResult,
  Settlement,
} from "./bank.types";

// ASSUMPTION: concrete bank API client is injected in production;
// here we provide the abstraction layer that wraps it.
@Injectable()
export class BankService {
  async send(request: BankSendRequest): Promise<BankSendResult> {
    // ASSUMPTION: real bank HTTP client call goes here.
    throw new Error("Bank service not configured");
  }

  async getStatement(start: Date, end: Date): Promise<Settlement[]> {
    // ASSUMPTION: real bank statement API call goes here.
    throw new Error("Bank service not configured");
  }
}
