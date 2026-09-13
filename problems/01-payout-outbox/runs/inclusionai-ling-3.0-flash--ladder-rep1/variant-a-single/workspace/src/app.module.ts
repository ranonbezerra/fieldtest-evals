import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PayoutModule } from "./payout/payout.module.js";

@Module({
  imports: [PrismaModule, PayoutModule],
})
export class AppModule {}
